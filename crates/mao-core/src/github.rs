//! GitHub API（REST）。画面向けの用語への変換は画面側で行う。
use crate::auth;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, thiserror::Error)]
pub enum GhError {
    #[error("GitHubに接続していません")]
    NotLoggedIn,
    #[error("通信に失敗しました: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Auth(#[from] auth::AuthError),
    #[error("GitHubが拒否しました（{status}）: {message}")]
    Api { status: u16, message: String },
}
pub type Result<T> = std::result::Result<T, GhError>;

pub(crate) fn token() -> Result<String> {
    auth::load_token()?.ok_or(GhError::NotLoggedIn)
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().user_agent("mao-explorer").build().expect("client")
}

async fn send(rb: reqwest::RequestBuilder) -> Result<Value> {
    let res = rb
        .bearer_auth(token()?)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?;
    let status = res.status();
    let text = res.text().await?;
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    if !status.is_success() {
        let message = v.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
        return Err(GhError::Api { status: status.as_u16(), message });
    }
    Ok(v)
}

fn url(path: &str) -> String {
    format!("https://api.github.com{path}")
}
async fn get(path: &str) -> Result<Value> {
    send(client().get(url(path))).await
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    /// 閲覧のみ（push不可）
    Read,
    /// 作業・依頼は可能（push可）。本体へ直接書けるかは保護設定次第。
    Write,
    /// 管理者・メンテナー
    Admin,
}

#[derive(Debug, Clone, Serialize)]
pub struct Project {
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub private: bool,
    pub description: Option<String>,
    pub default_branch: String,
    pub access: Access,
    pub updated_at: String,
}

fn to_project(r: &Value) -> Project {
    let p = &r["permissions"];
    let access = if p["admin"].as_bool() == Some(true) || p["maintain"].as_bool() == Some(true) {
        Access::Admin
    } else if p["push"].as_bool() == Some(true) {
        Access::Write
    } else {
        Access::Read
    };
    Project {
        full_name: r["full_name"].as_str().unwrap_or_default().into(),
        name: r["name"].as_str().unwrap_or_default().into(),
        owner: r["owner"]["login"].as_str().unwrap_or_default().into(),
        private: r["private"].as_bool().unwrap_or(false),
        description: r["description"].as_str().map(Into::into),
        default_branch: r["default_branch"].as_str().unwrap_or("main").into(),
        access,
        updated_at: r["updated_at"].as_str().unwrap_or_default().into(),
    }
}

pub async fn list_projects() -> Result<Vec<Project>> {
    let mut out = vec![];
    for page in 1..=10 {
        let v = get(&format!(
            "/user/repos?per_page=100&page={page}&sort=updated&affiliation=owner,collaborator,organization_member"
        ))
        .await?;
        let arr = v.as_array().cloned().unwrap_or_default();
        let n = arr.len();
        out.extend(arr.iter().map(to_project));
        if n < 100 {
            break;
        }
    }
    Ok(out)
}

pub async fn project(full_name: &str) -> Result<Project> {
    Ok(to_project(&get(&format!("/repos/{full_name}")).await?))
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 未同期プロジェクトの閲覧（フォルダ1階層ぶん）。
pub async fn browse(full_name: &str, path: &str, git_ref: &str) -> Result<Vec<RemoteEntry>> {
    let v = get(&format!("/repos/{full_name}/contents/{}?ref={git_ref}", enc_path(path))).await?;
    let mut list: Vec<RemoteEntry> = v
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|e| RemoteEntry {
            name: e["name"].as_str().unwrap_or_default().into(),
            path: e["path"].as_str().unwrap_or_default().into(),
            is_dir: e["type"].as_str() == Some("dir"),
            size: e["size"].as_u64().unwrap_or(0),
        })
        .collect();
    list.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(list)
}

/// テキストファイルの中身（1MB超・バイナリは None）。
pub async fn read_text(full_name: &str, path: &str, git_ref: &str) -> Result<Option<String>> {
    let res = client()
        .get(url(&format!("/repos/{full_name}/contents/{}?ref={git_ref}", enc_path(path))))
        .bearer_auth(token()?)
        .header("Accept", "application/vnd.github.raw+json")
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(GhError::Api { status: res.status().as_u16(), message: "読み込めません".into() });
    }
    let bytes = res.bytes().await?;
    if bytes.len() > 1_000_000 || bytes.iter().take(8000).any(|b| *b == 0) {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

pub async fn readme(full_name: &str) -> Result<Option<String>> {
    match get(&format!("/repos/{full_name}/readme")).await {
        Ok(v) => {
            let p = v["path"].as_str().unwrap_or("README.md").to_string();
            read_text(full_name, &p, "HEAD").await
        }
        Err(GhError::Api { status: 404, .. }) => Ok(None),
        Err(e) => Err(e),
    }
}

fn enc_path(p: &str) -> String {
    p.split('/')
        .map(|s| {
            s.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                    _ => format!("%{b:02X}"),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

// ---- 反映依頼（プルリクエスト） ----

#[derive(Debug, Clone, Serialize)]
pub struct Request {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub created_at: String,
    pub url: String,
    pub mine: bool,
    pub draft: bool,
}

pub async fn list_requests(full_name: &str, me: &str) -> Result<Vec<Request>> {
    let v = get(&format!("/repos/{full_name}/pulls?state=open&per_page=100")).await?;
    Ok(v.as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|p| {
            let author = p["user"]["login"].as_str().unwrap_or_default().to_string();
            Request {
                number: p["number"].as_u64().unwrap_or(0),
                title: p["title"].as_str().unwrap_or_default().into(),
                body: p["body"].as_str().unwrap_or_default().into(),
                mine: author.eq_ignore_ascii_case(me),
                author,
                head: p["head"]["ref"].as_str().unwrap_or_default().into(),
                base: p["base"]["ref"].as_str().unwrap_or_default().into(),
                created_at: p["created_at"].as_str().unwrap_or_default().into(),
                url: p["html_url"].as_str().unwrap_or_default().into(),
                draft: p["draft"].as_bool().unwrap_or(false),
            }
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub patch: Option<String>,
}

pub async fn request_files(full_name: &str, number: u64) -> Result<Vec<ChangedFile>> {
    let v = get(&format!("/repos/{full_name}/pulls/{number}/files?per_page=100")).await?;
    Ok(v.as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|f| ChangedFile {
            path: f["filename"].as_str().unwrap_or_default().into(),
            status: f["status"].as_str().unwrap_or_default().into(),
            additions: f["additions"].as_u64().unwrap_or(0),
            deletions: f["deletions"].as_u64().unwrap_or(0),
            patch: f["patch"].as_str().map(Into::into),
        })
        .collect())
}

/// 既存の依頼があればそれを返し、なければ作成する。
pub async fn create_request(full_name: &str, owner: &str, head: &str, base: &str, title: &str, body: &str) -> Result<u64> {
    let existing = get(&format!("/repos/{full_name}/pulls?state=open&head={owner}:{}", enc_path(head))).await?;
    if let Some(n) = existing.as_array().and_then(|a| a.first()).and_then(|p| p["number"].as_u64()) {
        if !body.is_empty() {
            comment(full_name, n, body).await?;
        }
        return Ok(n);
    }
    let v = send(client().post(url(&format!("/repos/{full_name}/pulls"))).json(&json!({
        "title": title, "body": body, "head": head, "base": base
    })))
    .await?;
    Ok(v["number"].as_u64().unwrap_or(0))
}

pub async fn comment(full_name: &str, number: u64, body: &str) -> Result<()> {
    send(client().post(url(&format!("/repos/{full_name}/issues/{number}/comments"))).json(&json!({ "body": body }))).await?;
    Ok(())
}

/// 修正を求める。自分の依頼にはレビューできないためコメントで代用する。
pub async fn request_changes(full_name: &str, number: u64, body: &str) -> Result<()> {
    let r = send(
        client()
            .post(url(&format!("/repos/{full_name}/pulls/{number}/reviews")))
            .json(&json!({ "event": "REQUEST_CHANGES", "body": body })),
    )
    .await;
    match r {
        Ok(_) => Ok(()),
        Err(GhError::Api { status: 422, .. }) => comment(full_name, number, &format!("【修正のお願い】\n{body}")).await,
        Err(e) => Err(e),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum MergeResult {
    Merged { sha: String },
    /// 実行できない理由（承認待ち・チェック中・競合など）
    Blocked { reason: String },
}

pub async fn merge_request(full_name: &str, number: u64) -> Result<MergeResult> {
    let r = send(client().put(url(&format!("/repos/{full_name}/pulls/{number}/merge"))).json(&json!({ "merge_method": "merge" }))).await;
    match r {
        Ok(v) => Ok(MergeResult::Merged { sha: v["sha"].as_str().unwrap_or_default().into() }),
        Err(GhError::Api { status, message }) if matches!(status, 403 | 405 | 409 | 422) => Ok(MergeResult::Blocked {
            reason: explain_block(status, &message),
        }),
        Err(e) => Err(e),
    }
}

fn explain_block(status: u16, msg: &str) -> String {
    let m = msg.to_lowercase();
    let why = if m.contains("review") || m.contains("approv") {
        "承認待ちです（責任者の承認が必要な設定です）"
    } else if m.contains("status check") || m.contains("check") {
        "確認処理中です（自動チェックの完了待ち）"
    } else if m.contains("conflict") || status == 409 {
        "本体と内容がぶつかっています（要対応）"
    } else if status == 403 {
        "本体に反映する権限がありません"
    } else {
        "現在は本体に反映できません"
    };
    format!("{why}。GitHubの応答: {msg}")
}

/// 本体の先頭に、指定コミットが含まれているか（反映完了の確認）。
pub async fn base_contains(full_name: &str, base: &str, sha: &str) -> Result<bool> {
    match get(&format!("/repos/{full_name}/compare/{sha}...{}", enc_path(base))).await {
        Ok(v) => Ok(matches!(v["status"].as_str(), Some("ahead") | Some("identical"))),
        Err(GhError::Api { status: 404, .. }) => Ok(false),
        Err(e) => Err(e),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MergeMode {
    /// 閲覧のみ。反映操作は出さない。
    None,
    /// 本体へ反映依頼（直接は書けない）
    Request,
    /// 本体に反映（依頼なしで実行できる見込み）
    Direct,
}

#[derive(Debug, Clone, Serialize)]
pub struct Capability {
    pub mode: MergeMode,
    /// 他の人の依頼を本体に反映できる見込み
    pub can_review: bool,
    /// 判定の根拠（画面の補足表示用）
    pub note: String,
}

/// 権限と、本体の保護状態から表示する操作を決める。
/// 保護の詳細は管理者しか読めないため、誰でも読める「保護の有無」と「ルール」で判定し、
/// 最終的な可否は実行時の応答で確定する。
pub async fn capability(p: &Project) -> Result<Capability> {
    if p.access == Access::Read {
        return Ok(Capability { mode: MergeMode::None, can_review: false, note: "閲覧のみの権限です".into() });
    }
    let b = enc_path(&p.default_branch);
    let protected = get(&format!("/repos/{}/branches/{b}", p.full_name))
        .await
        .map(|v| v["protected"].as_bool().unwrap_or(false))
        .unwrap_or(false);
    let needs_pr = get(&format!("/repos/{}/rules/branches/{b}", p.full_name))
        .await
        .map(|v| v.as_array().map(|a| a.iter().any(|r| r["type"] == "pull_request")).unwrap_or(false))
        .unwrap_or(false);
    Ok(match (&p.access, protected || needs_pr) {
        (Access::Admin, _) => Capability { mode: MergeMode::Direct, can_review: true, note: "管理者として本体に反映できます".into() },
        (_, false) => Capability { mode: MergeMode::Direct, can_review: true, note: "本体は保護されていません".into() },
        (_, true) => Capability {
            mode: MergeMode::Request,
            can_review: false,
            note: "本体は保護されています。責任者への依頼が必要です".into(),
        },
    })
}

pub async fn me() -> Result<String> {
    Ok(get("/user").await?["login"].as_str().unwrap_or_default().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn access_levels() {
        let a = to_project(&json!({"permissions":{"admin":false,"maintain":false,"push":true,"pull":true}}));
        assert_eq!(a.access, Access::Write);
        let b = to_project(&json!({"permissions":{"pull":true}}));
        assert_eq!(b.access, Access::Read);
        let c = to_project(&json!({"permissions":{"admin":true,"push":true}}));
        assert_eq!(c.access, Access::Admin);
    }
    #[test]
    fn encodes_japanese_paths() {
        assert_eq!(enc_path("資料/a b.txt"), "%E8%B3%87%E6%96%99/a%20b.txt");
    }
}
