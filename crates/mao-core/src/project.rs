//! ローカルのプロジェクト（初回同期・仮想フォルダ・状態・保存・同期）。
//!
//! 配置:
//!   <root>/本体/          … 既定ブランチの作業フォルダ（通常のクローン）
//!   <root>/<仮想フォルダ名>/ … git worktree（ブランチ mao/<名前>）
use git2::{
    build::{CheckoutBuilder, RepoBuilder},
    BranchType, Cred, FetchOptions, IndexAddOption, PushOptions, RemoteCallbacks, Repository, Signature,
    Status, StatusOptions, WorktreeAddOptions,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const MAIN_DIR: &str = "本体";
pub const BRANCH_PREFIX: &str = "mao/";

#[derive(Debug, thiserror::Error)]
pub enum ProjError {
    #[error("Gitの処理に失敗しました: {0}")]
    Git(#[from] git2::Error),
    #[error("ファイル操作に失敗しました: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Gh(#[from] crate::github::GhError),
    #[error("{0}")]
    User(String),
}
pub type Result<T> = std::result::Result<T, ProjError>;
fn user<T>(m: impl Into<String>) -> Result<T> {
    Err(ProjError::User(m.into()))
}

// ---------- 登録情報 ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalProject {
    pub root: PathBuf,
    pub default_branch: String,
}

fn registry_path() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("MAOExplorer").join("projects.json")
}

pub fn registry() -> BTreeMap<String, LocalProject> {
    std::fs::read_to_string(registry_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_registry(r: &BTreeMap<String, LocalProject>) -> Result<()> {
    let p = registry_path();
    std::fs::create_dir_all(p.parent().unwrap())?;
    std::fs::write(&p, serde_json::to_string_pretty(r).unwrap())?;
    Ok(())
}

pub fn local(full_name: &str) -> Option<LocalProject> {
    registry().get(full_name).cloned().filter(|p| p.root.join(MAIN_DIR).join(".git").exists())
}

pub fn default_root(name: &str) -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("MAO")
        .join(safe_file_name(name))
}

// ---------- 認証付きのリモート操作 ----------

fn callbacks<'a>(token: &'a str) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    cb.credentials(move |_, _, _| Cred::userpass_plaintext("x-access-token", token));
    cb
}

fn fetch_opts(token: &str) -> FetchOptions<'_> {
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(token));
    fo
}

fn fetch(repo: &Repository, token: &str) -> Result<()> {
    let mut remote = repo.find_remote("origin")?;
    remote.fetch(&["+refs/heads/*:refs/remotes/origin/*"], Some(&mut fetch_opts(token)), None)?;
    Ok(())
}

fn push(repo: &Repository, branch: &str, token: &str) -> Result<()> {
    let mut remote = repo.find_remote("origin")?;
    let rejected = std::cell::RefCell::new(None::<String>);
    {
        let mut cb = callbacks(token);
        cb.push_update_reference(|_, status| {
            if let Some(s) = status {
                *rejected.borrow_mut() = Some(s.to_string());
            }
            Ok(())
        });
        let mut po = PushOptions::new();
        po.remote_callbacks(cb);
        let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
        remote.push(&[spec.as_str()], Some(&mut po))?;
    }
    if let Some(r) = rejected.into_inner() {
        return user(format!("GitHubへの送信が拒否されました（{r}）。本体へ直接書き込めない設定の可能性があります。"));
    }
    // 追跡先を設定（初回送信の仮想フォルダ用）
    if let Ok(mut b) = repo.find_branch(branch, BranchType::Local) {
        let _ = b.set_upstream(Some(&format!("origin/{branch}")));
    }
    fetch(repo, token).ok();
    Ok(())
}

// ---------- 初回同期 ----------

pub fn first_sync(full_name: &str, default_branch: &str, root: &Path) -> Result<PathBuf> {
    let token = crate::github::token()?;
    let main = root.join(MAIN_DIR);
    if main.exists() && main.read_dir()?.next().is_some() {
        return user(format!("保存先が空ではありません: {}", main.display()));
    }
    std::fs::create_dir_all(&main)?;
    let url = format!("https://github.com/{full_name}.git");
    let res = RepoBuilder::new().fetch_options(fetch_opts(&token)).clone(&url, &main);
    if let Err(e) = res {
        // 途中で失敗した場合は、作りかけのフォルダだけ消す（利用者の変更は存在しない）
        let _ = std::fs::remove_dir_all(&main);
        return Err(e.into());
    }
    let mut reg = registry();
    reg.insert(full_name.into(), LocalProject { root: root.into(), default_branch: default_branch.into() });
    save_registry(&reg)?;
    Ok(main)
}

// ---------- 仮想フォルダ ----------

#[derive(Debug, Clone, Serialize)]
pub struct Folder {
    pub name: String,
    pub path: PathBuf,
    pub branch: String,
    pub is_main: bool,
    pub state: FolderState,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct FolderState {
    /// 未保存の変更ファイル数
    pub changes: usize,
    /// 送信待ちの保存数
    pub ahead: usize,
    /// 取得待ちの更新数（最後の確認時点）
    pub behind: usize,
    /// GitHubにまだ一度も送っていない
    pub unpublished: bool,
    /// 本体に入っていない保存の数（0なら反映する変更なし）
    pub not_in_main: usize,
}

fn main_repo(full_name: &str) -> Result<(LocalProject, Repository)> {
    let lp = local(full_name).ok_or_else(|| ProjError::User("このプロジェクトはまだ同期されていません".into()))?;
    let repo = Repository::open(lp.root.join(MAIN_DIR))?;
    Ok((lp, repo))
}

pub fn folders(full_name: &str) -> Result<Vec<Folder>> {
    let (lp, repo) = main_repo(full_name)?;
    let mut out = vec![Folder {
        name: MAIN_DIR.into(),
        path: lp.root.join(MAIN_DIR),
        branch: lp.default_branch.clone(),
        is_main: true,
        state: state(&repo, &lp.default_branch, &lp.default_branch)?,
    }];
    for wt_name in repo.worktrees()?.iter().flatten() {
        let wt = repo.find_worktree(wt_name)?;
        if wt.validate().is_err() {
            continue;
        }
        let r = Repository::open(wt.path())?;
        let branch = r.head()?.shorthand().unwrap_or_default().to_string();
        out.push(Folder {
            name: wt.path().file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            path: wt.path().into(),
            state: state(&r, &branch, &lp.default_branch)?,
            branch,
            is_main: false,
        });
    }
    Ok(out)
}

fn state(repo: &Repository, branch: &str, main: &str) -> Result<FolderState> {
    let mut s = FolderState { changes: changes_of(repo)?.len(), ..Default::default() };
    let head = repo.head()?.peel_to_commit()?.id();
    match repo.refname_to_id(&format!("refs/remotes/origin/{branch}")) {
        Ok(up) => {
            let (a, b) = repo.graph_ahead_behind(head, up)?;
            s.ahead = a;
            s.behind = b;
        }
        Err(_) => s.unpublished = true,
    }
    if let Ok(m) = repo.refname_to_id(&format!("refs/remotes/origin/{main}")) {
        s.not_in_main = repo.graph_ahead_behind(head, m)?.0;
    }
    Ok(s)
}

/// `from` を指定すると、そのコピーの保存済みの内容から作る（未指定なら本体の最新から）。
pub fn create_folder(full_name: &str, display: &str, from: Option<&Path>) -> Result<Folder> {
    let (lp, repo) = main_repo(full_name)?;
    let display = safe_file_name(display.trim());
    if display.is_empty() || display == MAIN_DIR {
        return user("この名前は使えません");
    }
    let path = lp.root.join(&display);
    if path.exists() {
        return user("同じ名前のフォルダがすでにあります");
    }
    let token = crate::github::token()?;
    fetch(&repo, &token).ok();
    let base = match from {
        Some(f) => Repository::open(f)?.head()?.peel_to_commit()?.id(),
        None => repo
        .refname_to_id(&format!("refs/remotes/origin/{}", lp.default_branch))
        .or_else(|_| repo.head().and_then(|h| h.peel_to_commit().map(|c| c.id())))?,
    };
    let branch = format!("{BRANCH_PREFIX}{}", safe_branch(&display));
    let commit = repo.find_commit(base)?;
    let br = repo.branch(&branch, &commit, false)?;
    let mut opts = WorktreeAddOptions::new();
    opts.reference(Some(br.get()));
    repo.worktree(&wt_id(&display), &path, Some(&opts))?;
    folders(full_name)?
        .into_iter()
        .find(|f| f.path == path)
        .ok_or_else(|| ProjError::User("仮想フォルダの作成後に見つかりません".into()))
}

// ---------- 変更と保存 ----------

#[derive(Debug, Clone, Serialize)]
pub struct Change {
    pub path: String,
    /// added / modified / deleted / renamed / conflicted
    pub kind: String,
}

fn changes_of(repo: &Repository) -> Result<Vec<Change>> {
    let mut so = StatusOptions::new();
    so.include_untracked(true).recurse_untracked_dirs(true).include_ignored(false).renames_head_to_index(true);
    let mut out = vec![];
    for e in repo.statuses(Some(&mut so))?.iter() {
        let s = e.status();
        let kind = if s.contains(Status::CONFLICTED) {
            "conflicted"
        } else if s.intersects(Status::WT_NEW | Status::INDEX_NEW) {
            "added"
        } else if s.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
            "deleted"
        } else if s.intersects(Status::WT_RENAMED | Status::INDEX_RENAMED) {
            "renamed"
        } else if s.intersects(Status::WT_MODIFIED | Status::INDEX_MODIFIED | Status::WT_TYPECHANGE | Status::INDEX_TYPECHANGE) {
            "modified"
        } else {
            continue;
        };
        out.push(Change { path: e.path().unwrap_or_default().into(), kind: kind.into() });
    }
    Ok(out)
}

pub fn changes(folder: &Path) -> Result<Vec<Change>> {
    changes_of(&Repository::open(folder)?)
}

fn signature(repo: &Repository, login: &str) -> Result<Signature<'static>> {
    Ok(match repo.signature() {
        Ok(s) => s.to_owned(),
        Err(_) => Signature::now(login, &format!("{login}@users.noreply.github.com"))?,
    })
}

/// 変更を履歴に保存する。files が空なら全変更。
pub fn save(folder: &Path, message: &str, files: &[String], login: &str) -> Result<String> {
    let repo = Repository::open(folder)?;
    if message.trim().is_empty() {
        return user("保存メッセージを入力してください");
    }
    let mut index = repo.index()?;
    if files.is_empty() {
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
        index.update_all(["*"].iter(), None)?;
    } else {
        for f in files {
            if folder.join(f).exists() {
                index.add_path(Path::new(f))?;
            } else {
                index.remove_path(Path::new(f))?;
            }
        }
    }
    index.write()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let parent = repo.head()?.peel_to_commit()?;
    if parent.tree_id() == tree.id() {
        return user("保存する変更がありません");
    }
    let sig = signature(&repo, login)?;
    let id = repo.commit(Some("HEAD"), &sig, &sig, message.trim(), &tree, &[&parent])?;
    Ok(id.to_string())
}

// ---------- 同期 ----------

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum SyncResult {
    /// 同期済み
    Done { received: usize, sent: usize },
    /// 未保存の変更があるため止めた
    NeedSave { changes: usize },
    /// 双方の変更がぶつかった（何も変更していない）
    Conflict { files: Vec<String> },
}

pub fn sync(folder: &Path, login: &str) -> Result<SyncResult> {
    let repo = Repository::open(folder)?;
    let n = changes_of(&repo)?.len();
    if n > 0 {
        return Ok(SyncResult::NeedSave { changes: n });
    }
    let token = crate::github::token()?;
    let branch = repo.head()?.shorthand().unwrap_or_default().to_string();
    fetch(&repo, &token)?;

    let head = repo.head()?.peel_to_commit()?.id();
    let up = match repo.refname_to_id(&format!("refs/remotes/origin/{branch}")) {
        Ok(u) => u,
        Err(_) => {
            // 一度も送っていない仮想フォルダ
            push(&repo, &branch, &token)?;
            return Ok(SyncResult::Done { received: 0, sent: 1 });
        }
    };
    let (ahead, behind) = repo.graph_ahead_behind(head, up)?;
    let mut received = 0;

    if behind > 0 && ahead == 0 {
        fast_forward(&repo, &branch, up)?;
        received = behind;
    } else if behind > 0 && ahead > 0 {
        let conflicts = rebase_onto(&repo, up, login)?;
        if !conflicts.is_empty() {
            return Ok(SyncResult::Conflict { files: conflicts });
        }
        received = behind;
    }
    let head = repo.head()?.peel_to_commit()?.id();
    let (ahead, _) = repo.graph_ahead_behind(head, up)?;
    if ahead > 0 {
        push(&repo, &branch, &token)?;
    }
    Ok(SyncResult::Done { received, sent: ahead })
}

/// 送信だけ行う（反映依頼の前など）。
pub fn publish(folder: &Path) -> Result<()> {
    let repo = Repository::open(folder)?;
    let branch = repo.head()?.shorthand().unwrap_or_default().to_string();
    push(&repo, &branch, &crate::github::token()?)
}

/// GitHub の最新状態を取り込む（ファイルは変更しない）。
pub fn refresh(folder: &Path) -> Result<()> {
    let repo = Repository::open(folder)?;
    fetch(&repo, &crate::github::token()?)
}

pub fn head_sha(folder: &Path) -> Result<String> {
    Ok(Repository::open(folder)?.head()?.peel_to_commit()?.id().to_string())
}

pub fn branch_of(folder: &Path) -> Result<String> {
    Ok(Repository::open(folder)?.head()?.shorthand().unwrap_or_default().to_string())
}

fn fast_forward(repo: &Repository, branch: &str, target: git2::Oid) -> Result<()> {
    let obj = repo.find_object(target, None)?;
    repo.checkout_tree(&obj, Some(CheckoutBuilder::new().safe()))?;
    repo.find_reference(&format!("refs/heads/{branch}"))?.set_target(target, "mao: 同期（取得）")?;
    repo.set_head(&format!("refs/heads/{branch}"))?;
    Ok(())
}

/// 自分の保存を相手の上に積み直す。ぶつかったら中止して元に戻し、対象ファイルを返す。
fn rebase_onto(repo: &Repository, upstream: git2::Oid, login: &str) -> Result<Vec<String>> {
    repo.index()?.read(true)?;
    let up = repo.find_annotated_commit(upstream)?;
    let mut rb = repo.rebase(None, Some(&up), None, None)?;
    let sig = signature(repo, login)?;
    while let Some(op) = rb.next() {
        op?;
        let idx = repo.index()?;
        if idx.has_conflicts() {
            let files = idx
                .conflicts()?
                .flatten()
                .filter_map(|c| c.our.or(c.their).map(|e| String::from_utf8_lossy(&e.path).into_owned()))
                .collect();
            rb.abort()?;
            return Ok(files);
        }
        match rb.commit(None, &sig, None) {
            Ok(_) => {}
            Err(e) if e.code() == git2::ErrorCode::Applied => {}
            Err(e) => {
                rb.abort()?;
                return Err(e.into());
            }
        }
    }
    rb.finish(Some(&sig))?;
    Ok(vec![])
}

// ---------- 一覧表示 ----------

#[derive(Debug, Clone, Serialize)]
pub struct LocalEntry {
    pub name: String,
    pub rel: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    /// 変更の種類（フォルダは配下に変更があれば "modified"）
    pub change: Option<String>,
}

pub fn list_dir(folder: &Path, rel: &str) -> Result<Vec<LocalEntry>> {
    let ch = changes(folder).unwrap_or_default();
    let dir = folder.join(rel);
    let mut out = vec![];
    for e in std::fs::read_dir(&dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let md = e.metadata()?;
        let r = if rel.is_empty() { name.clone() } else { format!("{}/{name}", rel.trim_end_matches('/')) };
        let change = if md.is_dir() {
            let pre = format!("{r}/");
            ch.iter().any(|c| c.path.starts_with(&pre)).then(|| "modified".to_string())
        } else {
            ch.iter().find(|c| c.path == r).map(|c| c.kind.clone())
        };
        out.push(LocalEntry {
            name,
            rel: r,
            is_dir: md.is_dir(),
            size: md.len(),
            modified: md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()),
            change,
        });
    }
    // 削除されたファイルも一覧に出す
    for c in ch.iter().filter(|c| c.kind == "deleted") {
        let parent = c.path.rsplit_once('/').map(|x| x.0).unwrap_or("");
        if parent == rel.trim_end_matches('/') {
            out.push(LocalEntry {
                name: c.path.rsplit('/').next().unwrap_or_default().into(),
                rel: c.path.clone(),
                is_dir: false,
                size: 0,
                modified: None,
                change: Some("deleted".into()),
            });
        }
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

// ---------- 名前の変換 ----------

pub fn safe_file_name(s: &str) -> String {
    let t: String = s.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c }).collect();
    t.trim().trim_end_matches('.').to_string()
}

pub fn safe_branch(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| if " ~^:?*[\\".contains(c) || c.is_control() { '-' } else { c })
        .collect::<String>()
        .replace("..", "-")
        .replace("@{", "-");
    t.trim_matches(|c| c == '.' || c == '/' || c == '-').trim_end_matches(".lock").to_string()
}

fn wt_id(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    format!("mao-{h:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(safe_branch("見積書 の修正"), "見積書-の修正");
        assert_eq!(safe_branch("a..b:c"), "a-b-c");
        assert_eq!(safe_file_name("a/b:c?"), "a_b_c_");
        assert!(wt_id("見積書").starts_with("mao-"));
    }

    /// ローカルだけで「保存→同期（送信・取得・競合）」を確かめる。
    #[test]
    fn save_sync_and_conflict_keep_local_changes() {
        let tmp = std::env::temp_dir().join(format!("mao-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let origin = tmp.join("origin.git");
        let bare = Repository::init_bare(&origin).unwrap();
        // 初期コミット
        {
            let sig = Signature::now("t", "t@t").unwrap();
            let mut tb = bare.treebuilder(None).unwrap();
            let blob = bare.blob(b"one\n").unwrap();
            tb.insert("a.txt", blob, 0o100644).unwrap();
            let tree = bare.find_tree(tb.write().unwrap()).unwrap();
            bare.commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[]).unwrap();
            bare.set_head("refs/heads/main").unwrap();
        }
        let a = tmp.join("a");
        let b = tmp.join("b");
        let ra = Repository::clone(origin.to_str().unwrap(), &a).unwrap();
        let rb = Repository::clone(origin.to_str().unwrap(), &b).unwrap();

        // A が保存して送る
        std::fs::write(a.join("a.txt"), "from A\n").unwrap();
        assert_eq!(changes(&a).unwrap().len(), 1);
        save(&a, "A", &[], "t").unwrap();
        push_local(&ra, "main");

        // B も同じ行を変えて保存 → 取得すると競合 → B の変更は残る
        std::fs::write(b.join("a.txt"), "from B\n").unwrap();
        save(&b, "B", &[], "t").unwrap();
        rb.find_remote("origin").unwrap().fetch(&["+refs/heads/*:refs/remotes/origin/*"], None, None).unwrap();
        let up = rb.refname_to_id("refs/remotes/origin/main").unwrap();
        let conflicts = rebase_onto(&rb, up, "t").unwrap();
        assert_eq!(conflicts, vec!["a.txt".to_string()]);
        assert_eq!(std::fs::read_to_string(b.join("a.txt")).unwrap().trim_end(), "from B");
        assert!(changes(&b).unwrap().is_empty(), "中止後は元の状態に戻る");

        // 別ファイルなら積み直しが成功する
        let rb2 = Repository::clone(origin.to_str().unwrap(), tmp.join("c")).unwrap();
        let c = tmp.join("c");
        std::fs::write(a.join("other.txt"), "x\n").unwrap();
        save(&a, "A2", &[], "t").unwrap();
        push_local(&ra, "main");
        std::fs::write(c.join("new.txt"), "c\n").unwrap();
        save(&c, "C", &[], "t").unwrap();
        rb2.find_remote("origin").unwrap().fetch(&["+refs/heads/*:refs/remotes/origin/*"], None, None).unwrap();
        let up = rb2.refname_to_id("refs/remotes/origin/main").unwrap();
        assert!(rebase_onto(&rb2, up, "t").unwrap().is_empty());
        assert!(c.join("other.txt").exists() && c.join("new.txt").exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    fn push_local(repo: &Repository, branch: &str) {
        let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
        repo.find_remote("origin").unwrap().push(&[spec.as_str()], None).unwrap();
    }
}
