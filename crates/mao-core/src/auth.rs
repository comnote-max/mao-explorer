//! GitHub Device Flow ログインと、OS資格情報へのトークン保存。
use serde::{Deserialize, Serialize};

const SERVICE: &str = "maociva.mao-explorer";
const ACCOUNT: &str = "github";
const SCOPE: &str = "repo read:org";
const UA: &str = "mao-explorer";

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("GitHubのクライアントIDが設定されていません（MAO_GITHUB_CLIENT_ID）")]
    NoClientId,
    #[error("通信に失敗しました: {0}")]
    Http(#[from] reqwest::Error),
    #[error("資格情報の保存に失敗しました: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("GitHubからの応答が不正です: {0}")]
    Bad(String),
}

pub type Result<T> = std::result::Result<T, AuthError>;

/// 公式ビルドのOAuth App（Device Flow用。公開してよい値）。
const DEFAULT_CLIENT_ID: &str = "Ov23liMOVEJ5ZgH19XIo";

/// 実行時の環境変数 → ビルド時の値 → 公式の値 の順に使う（フォーク版は自分の値で上書きできる）。
pub fn client_id() -> Result<String> {
    std::env::var("MAO_GITHUB_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("MAO_GITHUB_CLIENT_ID").map(str::to_string))
        .or_else(|| Some(DEFAULT_CLIENT_ID.to_string()))
        .filter(|s| !s.is_empty())
        .ok_or(AuthError::NoClientId)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PollResult {
    Pending,
    /// 間隔を延ばすよう求められた。新しい間隔（秒）。
    SlowDown { interval: u64 },
    Expired,
    Denied,
    Success { token: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().user_agent(UA).build().expect("http client")
}

pub async fn start() -> Result<DeviceCode> {
    let res = http()
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id()?.as_str()), ("scope", SCOPE)])
        .send()
        .await?
        .error_for_status()?;
    let v: serde_json::Value = res.json().await?;
    serde_json::from_value(v.clone()).map_err(|_| AuthError::Bad(v.to_string()))
}

/// トークン応答を解釈する（通信と分けて試験できるようにする）。
pub fn parse_poll(v: &serde_json::Value, current_interval: u64) -> Result<PollResult> {
    if let Some(t) = v.get("access_token").and_then(|t| t.as_str()) {
        return Ok(PollResult::Success { token: t.to_string() });
    }
    match v.get("error").and_then(|e| e.as_str()) {
        Some("authorization_pending") => Ok(PollResult::Pending),
        Some("slow_down") => Ok(PollResult::SlowDown {
            interval: v
                .get("interval")
                .and_then(|i| i.as_u64())
                .unwrap_or(current_interval + 5),
        }),
        Some("expired_token") => Ok(PollResult::Expired),
        Some("access_denied") => Ok(PollResult::Denied),
        _ => Err(AuthError::Bad(v.to_string())),
    }
}

/// 1回だけ問い合わせる。成功したらトークンを資格情報に保存する。
pub async fn poll(device_code: &str, interval: u64) -> Result<PollResult> {
    let v: serde_json::Value = http()
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id()?.as_str()),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await?
        .json()
        .await?;
    let r = parse_poll(&v, interval)?;
    if let PollResult::Success { token } = &r {
        save_token(token)?;
        // 画面へトークンを渡さない。
        return Ok(PollResult::Success { token: String::new() });
    }
    Ok(r)
}

fn entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, ACCOUNT)?)
}

pub fn save_token(token: &str) -> Result<()> {
    entry()?.set_password(token)?;
    Ok(())
}

pub fn load_token() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn logout() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// 保存済みトークンでアカウント情報を取得する。無効なら None。
pub async fn current_account() -> Result<Option<Account>> {
    let Some(token) = load_token()? else { return Ok(None) };
    let res = http()
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(None);
    }
    let v: serde_json::Value = res.error_for_status()?.json().await?;
    Ok(Some(Account {
        login: v["login"].as_str().unwrap_or_default().to_string(),
        name: v["name"].as_str().map(str::to_string),
        avatar_url: v["avatar_url"].as_str().unwrap_or_default().to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_all_poll_states() {
        assert_eq!(parse_poll(&json!({"error":"authorization_pending"}), 5).unwrap(), PollResult::Pending);
        assert_eq!(parse_poll(&json!({"error":"slow_down"}), 5).unwrap(), PollResult::SlowDown { interval: 10 });
        assert_eq!(parse_poll(&json!({"error":"slow_down","interval":15}), 5).unwrap(), PollResult::SlowDown { interval: 15 });
        assert_eq!(parse_poll(&json!({"error":"expired_token"}), 5).unwrap(), PollResult::Expired);
        assert_eq!(parse_poll(&json!({"error":"access_denied"}), 5).unwrap(), PollResult::Denied);
        assert_eq!(
            parse_poll(&json!({"access_token":"t","token_type":"bearer"}), 5).unwrap(),
            PollResult::Success { token: "t".into() }
        );
        assert!(parse_poll(&json!({"error":"incorrect_client_credentials"}), 5).is_err());
    }
}
