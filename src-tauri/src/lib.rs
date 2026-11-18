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
}

fn view(p: gh::Project) -> ProjectView {
    let lp = pj::local(&p.full_name);
    ProjectView { synced: lp.is_some(), root: lp.map(|l| l.root), project: p }
}

#[tauri::command]
async fn projects() -> R<Vec<ProjectView>> {
    let mut list: Vec<_> = gh::list_projects().await.map_err(s)?.into_iter().map(view).collect();
    list.sort_by_key(|p| !p.synced);
    Ok(list)
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
async fn create_folder(full_name: String, name: String, from: Option<PathBuf>) -> R<pj::Folder> {
    blocking(move || pj::create_folder(&full_name, &name, from.as_deref())).await
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
        if let Some(main) = folder.parent().map(|p| p.join(pj::MAIN_DIR)) {
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
async fn fs_read_text, file_diff(path: PathBuf) -> R<Option<String>> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            auth_account, login_start, login_poll, logout,
            projects, project_info, capability, browse_remote, read_remote, readme, default_root, first_sync,
            folders, create_folder,
            set_private,
            remove_folder, list_local, changes, save, sync,
            requests, request_files, send_request, merge_folder, merge_request, request_changes,
            fs_places, fs_list, fs_new_folder, fs_new_file, fs_rename, fs_delete, fs_copy, fs_move, fs_open, fs_reveal, fs_read_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running MAO Explorer");
}
