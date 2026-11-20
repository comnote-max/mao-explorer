//! 本物の GitHub での通し確認（作成→取り込み→編集→送信→下書き→依頼→反映→戻す→片付け）。
//! 使い方: cargo run -p mao-core --example e2e -- <作業用フォルダ>
//! GitHub 上のテスト用プロジェクトの削除はこのスクリプトでは行わない（名前を最後に表示する）。
use mao_core::{github as gh, project as pj};
use std::path::PathBuf;

fn step(n: &str) { println!("\n== {n}"); }

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(e) = run().await { println!("\n!! 失敗: {e}"); std::process::exit(1); }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let work = PathBuf::from(std::env::args().nth(1).ok_or("作業用フォルダを指定してください")?);
    let me = gh::me().await?;
    let name = format!("mao-e2e-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs());
    println!("ユーザー: {me} / プロジェクト: {name}");

    step("1. 作成（非公開）");
    let p = gh::create_project(&name, true, "【MAO通しテスト】自動テスト用。削除してかまいません").await?;
    let full = p.full_name.clone();
    println!("{full} 既定 branch={}", p.default_branch);
    let p = gh::project(&full).await?;
    let cap = gh::capability(&p).await?;
    println!("権限: {}", serde_json::to_string(&cap)?);

    step("2. PC に取り込み");
    let main = pj::first_sync(&full, &p.default_branch, &work.join(&name))?;
    println!("本体: {}", main.display());

    step("3. 本体で編集 → 保存 → 同期");
    std::fs::write(main.join("見積書.txt"), "A社 100円\n")?;
    println!("変更: {}", serde_json::to_string(&pj::changes(&main)?)?);
    pj::save(&main, "見積書を追加", &[], &me)?;
    println!("同期: {}", serde_json::to_string(&pj::sync(&main, &me)?)?);

    step("4. 下書きを作って編集（mao/ 付き・スペース入りの名前）");
    let d = pj::create_folder(&full, "mao/fix price", None, None)?;
    println!("下書き: name={} branch={} path={}", d.name, d.branch, d.path.display());
    let fs = pj::folders(&full)?;
    println!("フォルダ一覧: {:?}", fs.iter().map(|f| (&f.name, &f.branch)).collect::<Vec<_>>());
    std::fs::write(d.path.join("見積書.txt"), "A社 120円\n")?;
    pj::save(&d.path, "値上げ", &[], &me)?;

    step("5. 反映依頼（PR）→ 反映（merge）");
    pj::publish(&d.path)?;
    let head = pj::branch_of(&d.path)?;
    let n = gh::create_request(&full, &p.owner, &head, &p.default_branch, "値上げ", "テスト").await?;
    println!("PR #{n}");
    let reqs = gh::list_requests(&full, &me).await?;
    println!("依頼一覧: {} 件", reqs.len());
    let files = gh::request_files(&full, n).await?;
    println!("PR の変更: {:?}", files.iter().map(|f| (&f.path, f.additions, f.deletions)).collect::<Vec<_>>());
    let r = gh::merge_request(&full, n).await?;
    println!("merge: {}", serde_json::to_string(&r)?);
    if let gh::MergeResult::Merged { sha } = &r {
        println!("本体に入ったか: {}", gh::base_contains(&full, &p.default_branch, sha).await?);
    }

    step("6. 本体を同期して内容確認");
    println!("同期: {}", serde_json::to_string(&pj::sync(&main, &me)?)?);
    println!("本体の見積書: {:?}", std::fs::read_to_string(main.join("見積書.txt"))?);
    let st = pj::folders(&full)?;
    for f in &st { println!("  {} {}", f.name, serde_json::to_string(&f.state)?); }

    step("7. 履歴 → 差分 → 最初の状態に戻す");
    let h = pj::history(&main, 50)?;
    for e in &h { println!("  {} {} {}", &e.id[..7], e.message.lines().next().unwrap_or(""), if e.local_only { "未送信" } else { "" }); }
    let latest_with_file = h.iter().find(|e| pj::history_files(&main, &e.id).map(|f| f.iter().any(|c| c.path == "見積書.txt")).unwrap_or(false)).ok_or("見積書の履歴がない")?;
    println!("差分:\n{}", pj::history_diff(&main, &latest_with_file.id, "見積書.txt")?.unwrap_or("(バイナリ扱い)".into()));
    let first = h.last().ok_or("履歴がない")?;
    pj::restore_all(&main, &first.id, &me)?;
    println!("戻した後: 見積書あり={}", main.join("見積書.txt").exists());
    println!("同期: {}", serde_json::to_string(&pj::sync(&main, &me)?)?);

    step("8. 下書きを片付け");
    pj::remove_folder(&full, &d.path, true)?;
    println!("残りフォルダ: {:?}", pj::folders(&full)?.iter().map(|f| &f.name).collect::<Vec<_>>());

    println!("\n完了。GitHub 上の {full} は手動で削除してください。");
    Ok(())
}
