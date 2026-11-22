use mao_core::{auth, github as gh, project as pj};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

type R<T> = Result<T, String>;
fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 重いGit処理を別スレッドで実行する。
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, pj::ProjError> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(s)?.map_err(s)
}

static LOGIN: Mutex<Option<String>> = Mutex::new(None);
async fn login() -> R<String> {
    if let Some(l) = LOGIN.lock().unwrap().clone() {
        return Ok(l);
    }
    let l = gh::me().await.map_err(s)?;
    *LOGIN.lock().unwrap() = Some(l.clone());
    Ok(l)
}

// ---- ログイン ----

#[tauri::command]
async fn auth_account() -> R<Option<auth::Account>> {
    auth::current_account().await.map_err(s)
}
#[tauri::command]
async fn login_start() -> R<auth::DeviceCode> {
    auth::start().await.map_err(s)
}
#[tauri::command]
async fn login_poll(device_code: String, interval: u64) -> R<auth::PollResult> {
    auth::poll(&device_code, interval).await.map_err(s)
}
#[tauri::command]
fn logout() -> R<()> {
    *LOGIN.lock().unwrap() = None;
    auth::logout().map_err(s)
}

// ---- プロジェクト ----

#[derive(Serialize)]
struct ProjectView {
    #[serde(flatten)]
    project: gh::Project,
    synced: bool,
    root: Option<PathBuf>,
    /// 本体のフォルダ
    main: Option<PathBuf>,
}

fn view(p: gh::Project) -> ProjectView {
    let lp = pj::local(&p.full_name).or_else(|| pj::adopt_existing(&p.full_name, &[&p.name, &gh::display_name(&p.name, p.description.as_deref())], &p.default_branch));
    ProjectView { synced: lp.is_some(), main: lp.as_ref().map(|l| l.main_dir()), root: lp.map(|l| l.root), project: p }
}

#[tauri::command]
async fn projects() -> R<Vec<ProjectView>> {
    let mut list: Vec<_> = gh::list_projects().await.map_err(s)?.into_iter().map(view).collect();
    list.sort_by_key(|p| !p.synced);
    Ok(list)
}
#[tauri::command]
async fn create_project(name: String, private: bool, description: String) -> R<ProjectView> {
    Ok(view(gh::create_project(name.trim(), private, description.trim()).await.map_err(s)?))
}
#[tauri::command]
async fn project_info(full_name: String) -> R<ProjectView> {
    Ok(view(gh::project(&full_name).await.map_err(s)?))
}
#[tauri::command]
async fn set_private(full_name: String, private: bool) -> R<ProjectView> {
    Ok(view(gh::set_private(&full_name, private).await.map_err(s)?))
}
#[tauri::command]
async fn members(full_name: String) -> R<Vec<gh::Member>> {
    gh::members(&full_name).await.map_err(s)
}
#[tauri::command]
async fn invites(full_name: String) -> R<Vec<gh::Invite>> { gh::invites(&full_name).await.map_err(s) }
#[tauri::command]
async fn invite(full_name: String, login: String, role: String) -> R<bool> { gh::invite(&full_name, login.trim().trim_start_matches('@'), &role).await.map_err(s) }
#[tauri::command]
async fn cancel_invite(full_name: String, id: u64) -> R<()> { gh::cancel_invite(&full_name, id).await.map_err(s) }
#[tauri::command]
async fn remove_member(full_name: String, login: String) -> R<()> { gh::remove_member(&full_name, &login).await.map_err(s) }
#[tauri::command]
async fn capability(full_name: String) -> R<gh::Capability> {
    let p = gh::project(&full_name).await.map_err(s)?;
    gh::capability(&p).await.map_err(s)
}
#[tauri::command]
async fn browse_remote(full_name: String, path: String, git_ref: String) -> R<Vec<gh::RemoteEntry>> {
    gh::browse(&full_name, &path, &git_ref).await.map_err(s)
}
#[tauri::command]
async fn read_remote(full_name: String, path: String, git_ref: String) -> R<Option<String>> {
    gh::read_text(&full_name, &path, &git_ref).await.map_err(s)
}
#[tauri::command]
async fn readme(full_name: String) -> R<Option<String>> {
    gh::readme(&full_name).await.map_err(s)
}
#[tauri::command]
fn default_root(name: String) -> PathBuf {
    pj::default_root(&name)
}
/// GitHub Desktop でこのフォルダを開く（入っていなければ false）
#[tauri::command]
fn open_in_desktop(path: PathBuf) -> R<bool> {
    let url = format!("x-github-client://openLocalRepo/{}", path.display());
    #[cfg(windows)]
    {
        // 関連付けがなければ GitHub Desktop は入っていない
        let installed = std::process::Command::new("reg")
            .args(["query", r"HKCR\x-github-client"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !installed { return Ok(false); }
        std::process::Command::new("explorer.exe").arg(&url).spawn().map_err(s)?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Ok(false)
    }
}
#[tauri::command]
fn master_dir() -> PathBuf {
    pj::master_dir()
}
#[tauri::command]
fn set_master_dir(dir: PathBuf) -> R<()> {
    pj::set_master_dir(&dir).map_err(s)
}
#[tauri::command]
async fn first_sync(full_name: String, default_branch: String, root: PathBuf) -> R<PathBuf> {
    blocking(move || pj::first_sync(&full_name, &default_branch, &root)).await
}

// ---- 仮想フォルダ・保存・同期 ----

#[tauri::command]
async fn folders(full_name: String) -> R<Vec<pj::Folder>> {
    blocking(move || pj::folders(&full_name)).await
}
#[tauri::command]
async fn create_folder(full_name: String, name: String, from: Option<PathBuf>, at: Option<String>) -> R<pj::Folder> {
    blocking(move || pj::create_folder(&full_name, &name, from.as_deref(), at.as_deref())).await
}
#[tauri::command]
async fn history(folder: PathBuf) -> R<Vec<pj::HistoryEntry>> {
    blocking(move || pj::history(&folder, 300)).await
}
#[tauri::command]
async fn history_files(folder: PathBuf, id: String) -> R<Vec<pj::Change>> {
    blocking(move || pj::history_files(&folder, &id)).await
}
#[tauri::command]
async fn history_diff(folder: PathBuf, id: String, rel: String) -> R<Option<String>> {
    blocking(move || pj::history_diff(&folder, &id, &rel)).await
}
#[tauri::command]
async fn restore_file(folder: PathBuf, id: String, rel: String) -> R<()> {
    blocking(move || pj::restore_file(&folder, &id, &rel)).await
}
#[tauri::command]
async fn restore_all(folder: PathBuf, id: String) -> R<String> {
    let me = login().await?;
    blocking(move || pj::restore_all(&folder, &id, &me)).await
}
#[tauri::command]
async fn remove_folder(full_name: String, folder: PathBuf, remote: bool) -> R<()> {
    blocking(move || pj::remove_folder(&full_name, &folder, remote)).await
}
#[tauri::command]
async fn list_local(folder: PathBuf, rel: String) -> R<Vec<pj::LocalEntry>> {
    blocking(move || pj::list_dir(&folder, &rel)).await
}
#[tauri::command]
async fn file_diff(folder: PathBuf, rel: String) -> R<Option<String>> {
    blocking(move || pj::file_diff(&folder, &rel)).await
}
#[tauri::command]
async fn changes(folder: PathBuf) -> R<Vec<pj::Change>> {
    blocking(move || pj::changes(&folder)).await
}
#[tauri::command]
async fn save(folder: PathBuf, message: String, files: Vec<String>) -> R<String> {
    let me = login().await?;
    blocking(move || pj::save(&folder, &message, &files, &me)).await
}
#[tauri::command]
async fn sync(folder: PathBuf) -> R<pj::SyncResult> {
    let me = login().await?;
    blocking(move || pj::sync(&folder, &me)).await
}
#[tauri::command]
async fn pull(folder: PathBuf) -> R<pj::SyncResult> {
    let me = login().await?;
    blocking(move || pj::pull(&folder, &me)).await
}
#[tauri::command]
async fn move_to_draft(full_name: String, name: String) -> R<pj::Folder> {
    let me = login().await?;
    blocking(move || pj::move_to_draft(&full_name, &name, &me)).await
}
#[tauri::command]
async fn refresh(folder: PathBuf) -> R<()> {
    blocking(move || pj::refresh(&folder)).await
}
#[tauri::command]
async fn conflicts(folder: PathBuf, from: Option<String>) -> R<Vec<pj::ConflictFile>> {
    blocking(move || pj::conflicts_from(&folder, from.as_deref())).await
}
#[tauri::command]
async fn resolve(folder: PathBuf, picks: Vec<(String, String, Option<String>)>, from: Option<String>) -> R<pj::SyncResult> {
    let me = login().await?;
    blocking(move || pj::resolve(&folder, &picks, from.as_deref(), &me)).await
}
#[tauri::command]
async fn update_from_main(folder: PathBuf, main: String) -> R<pj::SyncResult> {
    let me = login().await?;
    blocking(move || pj::update_from_main(&folder, &main, &me)).await
}
#[tauri::command]
async fn push(folder: PathBuf) -> R<pj::SyncResult> {
    blocking(move || pj::push_only(&folder)).await
}

// ---- 本体への反映 ----

#[derive(Serialize)]
struct RequestsView {
    me: String,
    list: Vec<gh::Request>,
}

#[tauri::command]
async fn requests(full_name: String) -> R<RequestsView> {
    let me = login().await?;
    let list = gh::list_requests(&full_name, &me).await.map_err(s)?;
    Ok(RequestsView { me, list })
}
#[tauri::command]
async fn request_files(full_name: String, number: u64) -> R<Vec<gh::ChangedFile>> {
    gh::request_files(&full_name, number).await.map_err(s)
}

/// 仮想フォルダを送信し、本体への反映依頼を作る（既存があれば追記）。
async fn open_request(full_name: &str, folder: PathBuf, title: &str, message: &str) -> R<(u64, String)> {
    let f = folder.clone();
    blocking(move || pj::publish(&f)).await?;
    let head = blocking(move || pj::branch_of(&folder)).await?;
    let p = gh::project(full_name).await.map_err(s)?;
    let n = gh::create_request(full_name, &p.owner, &head, &p.default_branch, title, message)
        .await
        .map_err(s)?;
    Ok((n, p.default_branch))
}

#[tauri::command]
async fn send_request(full_name: String, folder: PathBuf, title: String, message: String) -> R<u64> {
    Ok(open_request(&full_name, folder, &title, &message).await?.0)
}

#[derive(Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
enum MergeView {
    /// GitHub上の本体に入ったことを確認済み
    Merged,
    /// 実行できない（理由付き）。依頼は残る。
    Blocked { reason: String, number: u64 },
    /// GitHubは成功を返したが、本体での確認ができない
    Unverified { number: u64 },
}

async fn merge_and_verify(full_name: &str, number: u64, base: &str) -> R<MergeView> {
    match gh::merge_request(full_name, number).await.map_err(s)? {
        gh::MergeResult::Blocked { reason } => Ok(MergeView::Blocked { reason, number }),
        gh::MergeResult::Merged { sha } => {
            if gh::base_contains(full_name, base, &sha).await.unwrap_or(false) {
                Ok(MergeView::Merged)
            } else {
                Ok(MergeView::Unverified { number })
            }
        }
    }
}

/// 権限のある人が、自分の仮想フォルダを依頼なしで本体に反映する。
#[tauri::command]
async fn merge_folder(full_name: String, folder: PathBuf, title: String) -> R<MergeView> {
    let f = folder.clone();
    let sha = blocking(move || pj::head_sha(&f)).await?;
    let p = gh::project(&full_name).await.map_err(s)?;
    // 既に本体に入っている（反映済み）なら、依頼を作らずに済ませる
    let r = if gh::base_contains(&full_name, &p.default_branch, &sha).await.unwrap_or(false) {
        MergeView::Merged
    } else {
        let (n, base) = open_request(&full_name, folder.clone(), &title, "").await?;
        merge_and_verify(&full_name, n, &base).await?
    };
    let me = login().await.unwrap_or_default();
    // 手元の「本体」フォルダにも反映後の内容を取り込む（未保存の変更があれば何もしない）
    blocking(move || {
        pj::refresh(&folder)?;
        if let Some(main) = pj::main_of(&folder) {
            if main != folder && main.exists() { let _ = pj::sync(&main, &me); }
        }
        Ok(())
    }).await.ok();
    Ok(r)
}

/// 受け取った依頼を本体に反映する。
#[tauri::command]
async fn merge_request(full_name: String, number: u64, base: String) -> R<MergeView> {
    merge_and_verify(&full_name, number, &base).await
}

#[tauri::command]
async fn request_changes(full_name: String, number: u64, message: String) -> R<()> {
    gh::request_changes(&full_name, number, &message).await.map_err(s)
}

// ---- 通常のファイル操作 ----

async fn fsb<T: Send + 'static>(f: impl FnOnce() -> Result<T, mao_core::fs::FsError> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(s)?.map_err(s)
}
use mao_core::fs as mfs;

#[tauri::command]
fn fs_places() -> Vec<mfs::Place> {
    mfs::places()
}
#[tauri::command]
async fn fs_list(path: PathBuf, show_hidden: bool) -> R<Vec<mfs::Entry>> {
    fsb(move || mfs::list(&path, show_hidden)).await
}
#[tauri::command]
async fn fs_new_folder(dir: PathBuf, name: String) -> R<PathBuf> {
    fsb(move || mfs::new_folder(&dir, &name)).await
}
#[tauri::command]
async fn fs_new_file(dir: PathBuf, name: String) -> R<PathBuf> {
    fsb(move || mfs::new_file(&dir, &name)).await
}
#[tauri::command]
async fn fs_rename(path: PathBuf, name: String) -> R<PathBuf> {
    fsb(move || mfs::rename(&path, &name)).await
}
#[tauri::command]
async fn fs_delete(paths: Vec<PathBuf>) -> R<()> {
    fsb(move || mfs::delete(&paths)).await
}
#[tauri::command]
async fn fs_copy(paths: Vec<PathBuf>, dest: PathBuf) -> R<Vec<PathBuf>> {
    fsb(move || mfs::copy(&paths, &dest)).await
}
#[tauri::command]
async fn fs_move(paths: Vec<PathBuf>, dest: PathBuf) -> R<Vec<PathBuf>> {
    fsb(move || mfs::move_to(&paths, &dest)).await
}
#[tauri::command]
async fn fs_read_text(path: PathBuf) -> R<Option<String>> {
    fsb(move || mfs::read_text(&path, 2 * 1024 * 1024)).await
}
/// OS標準のアプリで開く。
#[tauri::command]
fn fs_open(path: PathBuf) -> R<()> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(s)
}
/// OSのファイラーで場所を表示する（補助機能）。
#[tauri::command]
fn fs_reveal(path: PathBuf) -> R<()> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(s)
}

/// 開発用ブリッジ：MAO_BRIDGE=1 で起動したデバッグ版だけ、127.0.0.1:1430 で
/// ブラウザ（http://localhost:1420/?bridge）から本物のコマンドを呼べるようにする。テストの自動操作用。
#[cfg(debug_assertions)]
mod bridge {
    use super::*;
    use serde_json::{from_value, to_value, Value};
    use std::io::{Read, Write};

    fn g<T: serde::de::DeserializeOwned>(a: &Value, k: &str) -> R<T> {
        from_value(a.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| format!("{k}: {e}"))
    }
    fn v<T: Serialize>(x: T) -> R<Value> { to_value(x).map_err(s) }

    async fn dispatch(cmd: &str, a: Value) -> R<Value> {
        match cmd {
            "auth_account" => v(auth_account().await?),
            "login_start" => v(login_start().await?),
            "login_poll" => v(login_poll(g(&a, "deviceCode")?, g(&a, "interval")?).await?),
            "logout" => v(logout()?),
            "projects" => v(projects().await?),
            "create_project" => v(create_project(g(&a, "name")?, g(&a, "private")?, g(&a, "description")?).await?),
            "project_info" => v(project_info(g(&a, "fullName")?).await?),
            "set_private" => v(set_private(g(&a, "fullName")?, g(&a, "private")?).await?),
            "members" => v(members(g(&a, "fullName")?).await?),
            "invites" => v(invites(g(&a, "fullName")?).await?),
            "invite" => v(invite(g(&a, "fullName")?, g(&a, "login")?, g(&a, "role")?).await?),
            "cancel_invite" => v(cancel_invite(g(&a, "fullName")?, g(&a, "id")?).await?),
            "remove_member" => v(remove_member(g(&a, "fullName")?, g(&a, "login")?).await?),
            "capability" => v(capability(g(&a, "fullName")?).await?),
            "browse_remote" => v(browse_remote(g(&a, "fullName")?, g(&a, "path")?, g(&a, "gitRef")?).await?),
            "read_remote" => v(read_remote(g(&a, "fullName")?, g(&a, "path")?, g(&a, "gitRef")?).await?),
            "readme" => v(readme(g(&a, "fullName")?).await?),
            "default_root" => v(default_root(g(&a, "name")?)),
            "open_in_desktop" => v(false),
            "master_dir" => v(master_dir()),
            "set_master_dir" => v(set_master_dir(g(&a, "dir")?)?),
            "first_sync" => v(first_sync(g(&a, "fullName")?, g(&a, "defaultBranch")?, g(&a, "root")?).await?),
            "folders" => v(folders(g(&a, "fullName")?).await?),
            "create_folder" => v(create_folder(g(&a, "fullName")?, g(&a, "name")?, g(&a, "from")?, g(&a, "at")?).await?),
            "history" => v(history(g(&a, "folder")?).await?),
            "history_files" => v(history_files(g(&a, "folder")?, g(&a, "id")?).await?),
            "history_diff" => v(history_diff(g(&a, "folder")?, g(&a, "id")?, g(&a, "rel")?).await?),
            "restore_file" => v(restore_file(g(&a, "folder")?, g(&a, "id")?, g(&a, "rel")?).await?),
            "restore_all" => v(restore_all(g(&a, "folder")?, g(&a, "id")?).await?),
            "remove_folder" => v(remove_folder(g(&a, "fullName")?, g(&a, "folder")?, g(&a, "remote")?).await?),
            "list_local" => v(list_local(g(&a, "folder")?, g(&a, "rel")?).await?),
            "file_diff" => v(file_diff(g(&a, "folder")?, g(&a, "rel")?).await?),
            "changes" => v(changes(g(&a, "folder")?).await?),
            "save" => v(save(g(&a, "folder")?, g(&a, "message")?, g(&a, "files")?).await?),
            "sync" => v(sync(g(&a, "folder")?).await?),
            "pull" => v(pull(g(&a, "folder")?).await?),
            "push" => v(push(g(&a, "folder")?).await?),
            "refresh" => v(refresh(g(&a, "folder")?).await?),
            "conflicts" => v(conflicts(g(&a, "folder")?, g(&a, "from")?).await?),
            "resolve" => v(resolve(g(&a, "folder")?, g(&a, "picks")?, g(&a, "from")?).await?),
            "update_from_main" => v(update_from_main(g(&a, "folder")?, g(&a, "main")?).await?),
            "move_to_draft" => v(move_to_draft(g(&a, "fullName")?, g(&a, "name")?).await?),
            "requests" => v(requests(g(&a, "fullName")?).await?),
            "request_files" => v(request_files(g(&a, "fullName")?, g(&a, "number")?).await?),
            "send_request" => v(send_request(g(&a, "fullName")?, g(&a, "folder")?, g(&a, "title")?, g(&a, "message")?).await?),
            "merge_folder" => v(merge_folder(g(&a, "fullName")?, g(&a, "folder")?, g(&a, "title")?).await?),
            "merge_request" => v(merge_request(g(&a, "fullName")?, g(&a, "number")?, g(&a, "base")?).await?),
            "request_changes" => v(request_changes(g(&a, "fullName")?, g(&a, "number")?, g(&a, "message")?).await?),
            "fs_places" => v(fs_places()),
            "fs_list" => v(fs_list(g(&a, "path")?, g(&a, "showHidden")?).await?),
            "fs_new_folder" => v(fs_new_folder(g(&a, "dir")?, g(&a, "name")?).await?),
            "fs_new_file" => v(fs_new_file(g(&a, "dir")?, g(&a, "name")?).await?),
            "fs_rename" => v(fs_rename(g(&a, "path")?, g(&a, "name")?).await?),
            "fs_delete" => v(fs_delete(g(&a, "paths")?).await?),
            "fs_copy" => v(fs_copy(g(&a, "paths")?, g(&a, "dest")?).await?),
            "fs_move" => v(fs_move(g(&a, "paths")?, g(&a, "dest")?).await?),
            "fs_read_text" => v(fs_read_text(g(&a, "path")?).await?),
            "fs_reveal" => v(()),
            // ブラウザ内の簡易エディタで保存する（ブリッジ専用）
            "fs_write_text" => v(std::fs::write(g::<PathBuf>(&a, "path")?, g::<String>(&a, "text")?).map_err(s)?),
            _ => Err(format!("ブリッジ未対応のコマンド: {cmd}")),
        }
    }

    const ORIGIN: &str = "http://localhost:1420";

    fn handle(mut st: std::net::TcpStream) {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 8192];
        let head_end = loop {
            let n = match st.read(&mut tmp) { Ok(0) | Err(_) => return, Ok(n) => n };
            buf.extend_from_slice(&tmp[..n]);
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") { break i + 4; }
            if buf.len() > 1 << 20 { return; }
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
        let mut lines = head.lines();
        let first = lines.next().unwrap_or_default().to_string();
        let mut len = 0usize;
        let mut origin = String::new();
        let mut marked = false;
        for l in lines {
            let (k, val) = l.split_once(':').map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())).unwrap_or_default();
            match k.as_str() { "content-length" => len = val.parse().unwrap_or(0), "origin" => origin = val, "x-mao-bridge" => marked = val == "1", _ => {} }
        }
        while buf.len() < head_end + len {
            let n = match st.read(&mut tmp) { Ok(0) | Err(_) => break, Ok(n) => n };
            buf.extend_from_slice(&tmp[..n]);
        }
        let cors = format!("Access-Control-Allow-Origin: {ORIGIN}\r\nAccess-Control-Allow-Headers: content-type, x-mao-bridge\r\nAccess-Control-Allow-Methods: POST\r\n");
        let mut parts = first.split_whitespace();
        let (method, path) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
        if method == "OPTIONS" {
            let _ = st.write_all(format!("HTTP/1.1 204 No Content\r\n{cors}Content-Length: 0\r\n\r\n").as_bytes());
            return;
        }
        // 開発中のページ以外からは受け付けない
        if method != "POST" || origin != ORIGIN || !marked || !path.starts_with("/invoke/") {
            let _ = st.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
            return;
        }
        let cmd = path.trim_start_matches("/invoke/").to_string();
        let args: Value = serde_json::from_slice(&buf[head_end..]).unwrap_or(Value::Null);
        let res = tauri::async_runtime::block_on(dispatch(&cmd, args));
        let body = match res { Ok(x) => serde_json::json!({ "ok": x }), Err(e) => serde_json::json!({ "err": e }) }.to_string();
        let _ = st.write_all(format!("HTTP/1.1 200 OK\r\n{cors}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes());
    }

    pub fn start() {
        if std::env::var("MAO_BRIDGE").ok().as_deref() != Some("1") { return; }
        std::thread::spawn(|| {
            let Ok(l) = std::net::TcpListener::bind("127.0.0.1:1430") else { eprintln!("[bridge] 1430 番を使えません"); return; };
            eprintln!("[bridge] http://127.0.0.1:1430 で待機中");
            for st in l.incoming().flatten() { std::thread::spawn(move || handle(st)); }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    bridge::start();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            auth_account, login_start, login_poll, logout,
            projects, create_project, project_info, capability, browse_remote, read_remote, readme, default_root, master_dir, set_master_dir, open_in_desktop, first_sync,
            folders, create_folder, history, history_files, history_diff, restore_file, restore_all,
            set_private, members, invites, invite, cancel_invite, remove_member,
            remove_folder, list_local, changes, save, sync, pull, push, move_to_draft, conflicts, resolve, refresh, update_from_main,
            requests, request_files, send_request, merge_folder, merge_request, request_changes,
            fs_places, fs_list, fs_new_folder, fs_new_file, fs_rename, fs_delete, fs_copy, fs_move, fs_open, fs_reveal, fs_read_text, file_diff
        ])
        .run(tauri::generate_context!())
        .expect("error while running MAO Explorer");
}
