//! ローカルのプロジェクト（初回同期・仮想フォルダ・状態・保存・同期）。
//!
//! 配置:
//!   <保存先>/<名前>/                   … 本体（通常のクローン。GitHub Desktop と同じ場所）
//!   <保存先>/.mao-drafts/<名前>/<下書き>/ … git worktree（ブランチ mao/<名前>）
//! 旧形式（<root>/本体/ と <root>/<下書き>/）もそのまま使える。
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
    /// 下書き（worktree）を置く場所
    pub root: PathBuf,
    pub default_branch: String,
    /// 本体の場所（なければ旧形式の <root>/本体）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main: Option<PathBuf>,
}

impl LocalProject {
    pub fn main_dir(&self) -> PathBuf {
        self.main.clone().unwrap_or_else(|| self.root.join(MAIN_DIR))
    }
}

// ---------- 保存先（マスターフォルダ） ----------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Settings {
    #[serde(default)]
    master: Option<PathBuf>,
}

fn settings_path() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("MAOExplorer").join("settings.json")
}

fn settings() -> Settings {
    std::fs::read_to_string(settings_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// プロジェクトを置く親フォルダ。既定は C:\GitHub（GitHub Desktop と同じ）。
pub fn master_dir() -> PathBuf {
    settings().master.unwrap_or_else(|| {
        let c = PathBuf::from("C:\\");
        if cfg!(windows) && c.exists() { c.join("GitHub") } else { dirs::home_dir().unwrap_or_else(std::env::temp_dir).join("GitHub") }
    })
}

pub fn set_master_dir(dir: &Path) -> Result<()> {
    let mut st = settings();
    st.master = Some(dir.into());
    let p = settings_path();
    std::fs::create_dir_all(p.parent().unwrap())?;
    std::fs::write(&p, serde_json::to_string_pretty(&st).unwrap())?;
    Ok(())
}

/// 本体の場所から、下書きを置く場所を決める（<親>/.mao-drafts/<名前>）
fn drafts_root(main: &Path) -> PathBuf {
    let name = main.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    main.parent().unwrap_or(main).join(".mao-drafts").join(name)
}

/// フォルダの origin が full_name の GitHub リポジトリか
fn is_clone_of(dir: &Path, full_name: &str) -> bool {
    let Ok(repo) = Repository::open(dir) else { return false };
    let Ok(remote) = repo.find_remote("origin") else { return false };
    let url = remote.url().unwrap_or_default().trim_end_matches('/').trim_end_matches(".git").to_lowercase();
    let want = full_name.to_lowercase();
    url.ends_with(&format!("/{want}")) || url.ends_with(&format!(":{want}"))
}

fn register(full_name: &str, default_branch: &str, main: &Path) -> Result<LocalProject> {
    let lp = LocalProject { root: drafts_root(main), default_branch: default_branch.into(), main: Some(main.into()) };
    let mut reg = registry();
    reg.insert(full_name.into(), lp.clone());
    save_registry(&reg)?;
    Ok(lp)
}

/// 保存先にすでにクローンがあれば（GitHub Desktop などで取り込み済み）、そのまま本体として使う
pub fn adopt_existing(full_name: &str, names: &[&str], default_branch: &str) -> Option<LocalProject> {
    names.iter().find_map(|name| {
        let dir = master_dir().join(safe_file_name(name));
        if dir.join(".git").exists() && is_clone_of(&dir, full_name) { register(full_name, default_branch, &dir).ok() } else { None }
    })
}

/// 下書き（worktree）や本体の中のフォルダから、本体のフォルダを求める
pub fn main_of(folder: &Path) -> Option<PathBuf> {
    let repo = Repository::open(folder).ok()?;
    if !repo.is_worktree() {
        return repo.workdir().map(|p| p.to_path_buf());
    }
    // worktree の .git/worktrees/<id>/commondir に本体の .git への相対パスが書いてある
    let gitdir = repo.path();
    let rel = std::fs::read_to_string(gitdir.join("commondir")).ok()?;
    let common = gitdir.join(rel.trim());
    let common = std::fs::canonicalize(&common).unwrap_or(common);
    let main = common.parent()?.to_path_buf();
    // canonicalize の \\?\ 接頭辞を外す
    let s = main.to_string_lossy();
    Some(PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()))
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
    registry().get(full_name).cloned().filter(|p| p.main_dir().join(".git").exists())
}

/// 初回同期の既定の保存先（本体を置くフォルダ）
pub fn default_root(name: &str) -> PathBuf {
    master_dir().join(safe_file_name(name))
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

/// `main` に本体を取り込む。すでに同じリポジトリのクローンがあれば、それをそのまま使う。
pub fn first_sync(full_name: &str, default_branch: &str, main: &Path) -> Result<PathBuf> {
    if main.join(".git").exists() && is_clone_of(main, full_name) {
        register(full_name, default_branch, main)?;
        return Ok(main.into());
    }
    let token = crate::github::token()?;
    let main = main.to_path_buf();
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
    register(full_name, default_branch, &main)?;
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
    let repo = Repository::open(lp.main_dir())?;
    Ok((lp, repo))
}

pub fn folders(full_name: &str) -> Result<Vec<Folder>> {
    let (lp, repo) = main_repo(full_name)?;
    let mut out = vec![Folder {
        name: MAIN_DIR.into(),
        path: lp.main_dir(),
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
pub fn create_folder(full_name: &str, display: &str, from: Option<&Path>, at: Option<&str>) -> Result<Folder> {
    let (lp, repo) = main_repo(full_name)?;
    // 「mao/」は自動で付けるので、入力に含まれていたら外す（mao/mao/… にしない）
    let display = safe_file_name(display.trim().trim_start_matches(BRANCH_PREFIX).trim());
    if display.is_empty() || display == MAIN_DIR {
        return user("この名前は使えません");
    }
    let path = lp.root.join(&display);
    if path.exists() {
        return user("同じ名前のフォルダがすでにあります");
    }
    std::fs::create_dir_all(&lp.root)?;
    let token = crate::github::token()?;
    fetch(&repo, &token).ok();
    let base = match from {
        _ if at.is_some() => git2::Oid::from_str(at.unwrap_or_default())?,
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

/// 本体に直接送れない（保護されている）ときに、本体での変更をそのまま新しい下書きへ移す。
/// 未保存の変更は自動で履歴保存し、その内容で下書きを作ってから、本体はクラウドの状態に戻す。
pub fn move_to_draft(full_name: &str, display: &str, login: &str) -> Result<Folder> {
    let (lp, repo) = main_repo(full_name)?;
    if !changes_of(&repo)?.is_empty() {
        save(&lp.main_dir(), "本体での変更（下書きへ移動）", &[], login)?;
    }
    let head = repo.head()?.peel_to_commit()?.id();
    let up = repo.refname_to_id(&format!("refs/remotes/origin/{}", lp.default_branch))?;
    if head == up || repo.graph_ahead_behind(head, up)?.0 == 0 {
        return user("移す変更がありません");
    }
    let f = create_folder(full_name, display, None, Some(&head.to_string()))?;
    // 変更は下書き側に残ったので、本体はクラウドと同じ状態に戻す（作業ツリーは保存済みでクリーン）
    let obj = repo.find_object(up, None)?;
    repo.reset(&obj, git2::ResetType::Hard, Some(CheckoutBuilder::new().force()))?;
    Ok(f)
}

/// コピー（仮想フォルダ）を片付ける。フォルダはごみ箱へ移すので、ファイルは元に戻せる。
/// `remote` が true なら GitHub 上の作業場所も消す（本体に反映済みのときに使う）。
pub fn remove_folder(full_name: &str, folder: &Path, remote: bool) -> Result<()> {
    let (lp, repo) = main_repo(full_name)?;
    if folder == lp.main_dir() {
        return user("本体は削除できません");
    }
    let branch = branch_of(folder)?;
    let display = folder.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    trash::delete(folder).map_err(|e| ProjError::User(format!("フォルダをごみ箱へ移せませんでした：{e}")))?;
    // Git 側の登録を外す（フォルダはもう無いので prune で消える）
    for id in [wt_id(&display), display.clone()] {
        if let Ok(wt) = repo.find_worktree(&id) {
            let _ = wt.prune(Some(git2::WorktreePruneOptions::new().valid(true).working_tree(false)));
        }
    }
    if let Ok(names) = repo.worktrees() {
        for id in names.iter().flatten() {
            if let Ok(wt) = repo.find_worktree(id) {
                if wt.path() == folder { let _ = wt.prune(Some(git2::WorktreePruneOptions::new().valid(true))); }
            }
        }
    }
    if let Ok(mut b) = repo.find_branch(&branch, BranchType::Local) {
        let _ = b.delete();
    }
    if remote && branch.starts_with(BRANCH_PREFIX) {
        let token = crate::github::token()?;
        let mut r = repo.find_remote("origin")?;
        let mut po = PushOptions::new();
        po.remote_callbacks(callbacks(&token));
        let _ = r.push(&[format!(":refs/heads/{branch}").as_str()], Some(&mut po));
        let _ = fetch(&repo, &token);
        if let Ok(mut rb) = repo.find_branch(&format!("origin/{branch}"), BranchType::Remote) { let _ = rb.delete(); }
    }
    Ok(())
}

// ---------- 変更と保存 ----------

/// 1ファイルの「最後の保存」からの変更点（unified diff）。大きすぎる・文字でない場合は None。
pub fn file_diff(folder: &Path, rel: &str) -> Result<Option<String>> {
    let repo = Repository::open(folder)?;
    let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(rel).disable_pathspec_match(true).include_untracked(true)
        .recurse_untracked_dirs(true).show_untracked_content(true).context_lines(3);
    let diff = repo.diff_tree_to_workdir_with_index(head.as_ref(), Some(&mut opts))?;
    let mut out = String::new();
    let mut binary = false;
    diff.print(git2::DiffFormat::Patch, |delta, _, line| {
        if delta.flags().is_binary() { binary = true; return true; }
        if line.origin() == 'F' { return true; }
        match line.origin() {
            '+' | '-' | ' ' => out.push(line.origin()),
            _ => {}
        }
        out.push_str(&String::from_utf8_lossy(line.content()));
        out.len() < 2_000_000
    })?;
    if binary { return Ok(None); }
    Ok(Some(out))
}

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
        return user("履歴保存のメッセージを入力してください");
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
        return user("履歴保存する変更がありません");
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
        // 双方に新しい記録がある：merge で合わせる（ぶつかったら解決画面へ）。commit は書き換えない
        return merge_or_conflict(folder, login, true);
    }
    let head = repo.head()?.peel_to_commit()?.id();
    let (ahead, _) = repo.graph_ahead_behind(head, up)?;
    if ahead > 0 {
        push(&repo, &branch, &token)?;
    }
    Ok(SyncResult::Done { received, sent: ahead })
}

/// 受信だけ行う（クラシックの Pull）。fetch して、fast-forward か自分の commit を積み直す（rebase）。
pub fn pull(folder: &Path, login: &str) -> Result<SyncResult> {
    let repo = Repository::open(folder)?;
    let n = changes_of(&repo)?.len();
    if n > 0 {
        return Ok(SyncResult::NeedSave { changes: n });
    }
    let token = crate::github::token()?;
    let branch = repo.head()?.shorthand().unwrap_or_default().to_string();
    fetch(&repo, &token)?;
    let Ok(up) = repo.refname_to_id(&format!("refs/remotes/origin/{branch}")) else {
        return Ok(SyncResult::Done { received: 0, sent: 0 });
    };
    let head = repo.head()?.peel_to_commit()?.id();
    let (ahead, behind) = repo.graph_ahead_behind(head, up)?;
    if behind > 0 && ahead == 0 {
        fast_forward(&repo, &branch, up)?;
    } else if behind > 0 {
        return merge_or_conflict(folder, login, false);
    }
    Ok(SyncResult::Done { received: behind, sent: 0 })
}

/// 送信だけ行う（クラシックの Push）。相手側が先に進んでいたら送らずに止める（先に Pull）。
pub fn push_only(folder: &Path) -> Result<SyncResult> {
    let repo = Repository::open(folder)?;
    let token = crate::github::token()?;
    let branch = repo.head()?.shorthand().unwrap_or_default().to_string();
    fetch(&repo, &token)?;
    let head = repo.head()?.peel_to_commit()?.id();
    let Ok(up) = repo.refname_to_id(&format!("refs/remotes/origin/{branch}")) else {
        push(&repo, &branch, &token)?;
        return Ok(SyncResult::Done { received: 0, sent: 1 });
    };
    let (ahead, behind) = repo.graph_ahead_behind(head, up)?;
    if behind > 0 {
        return user("origin 側に新しい commit があります。先に Pull してください");
    }
    if ahead > 0 {
        push(&repo, &branch, &token)?;
    }
    Ok(SyncResult::Done { received: 0, sent: ahead })
}

// ---------- ぶつかったときの解決 ----------

/// ぶつかったファイル 1 つ分。文字のファイルでなければ中身は None（どちらかを選ぶだけ）。
#[derive(Debug, Clone, Serialize)]
pub struct ConflictFile {
    pub path: String,
    /// この PC の内容（None なら PC 側で削除 or 文字でない）
    pub mine: Option<String>,
    pub theirs: Option<String>,
    pub mine_deleted: bool,
    pub theirs_deleted: bool,
}

/// 手元（HEAD）とクラウド（origin/同名）を合わせた結果の索引を作る（ファイルは変えない）。
/// from を指定すると、その branch（例：本体の main）のクラウド側を取り込む。None なら同じ名前の branch。
fn merge_index(repo: &Repository, from: Option<&str>) -> Result<(git2::Index, git2::Oid, git2::Oid, String)> {
    let branch = repo.head()?.shorthand().unwrap_or_default().to_string();
    let head = repo.head()?.peel_to_commit()?;
    let up = repo.refname_to_id(&format!("refs/remotes/origin/{}", from.unwrap_or(&branch)))?;
    let theirs = repo.find_commit(up)?;
    let idx = repo.merge_commits(&head, &theirs, None)?;
    Ok((idx, head.id(), up, branch))
}

fn blob_text(repo: &Repository, e: &Option<git2::IndexEntry>) -> Option<String> {
    let e = e.as_ref()?;
    let b = repo.find_blob(e.id).ok()?;
    if b.is_binary() { return None; }
    String::from_utf8(b.content().to_vec()).ok()
}

/// ぶつかっているファイルの一覧と、両方の中身。
pub fn conflicts(folder: &Path) -> Result<Vec<ConflictFile>> {
    conflicts_from(folder, None)
}

pub fn conflicts_from(folder: &Path, from: Option<&str>) -> Result<Vec<ConflictFile>> {
    let repo = Repository::open(folder)?;
    let (idx, ..) = merge_index(&repo, from)?;
    let mut out = Vec::new();
    for c in idx.conflicts()? {
        let c = c?;
        let any = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref());
        let path = any.map(|e| String::from_utf8_lossy(&e.path).to_string()).unwrap_or_default();
        out.push(ConflictFile {
            mine: blob_text(&repo, &c.our),
            theirs: blob_text(&repo, &c.their),
            mine_deleted: c.our.is_none(),
            theirs_deleted: c.their.is_none(),
            path,
        });
    }
    Ok(out)
}

/// 選んだ内容でぶつかりを解決し、クラウドの更新を取り込んだ記録（merge commit）を作って送る。
/// picks: (パス, "mine" | "theirs" | "edit", edit のときの本文)
pub fn resolve(folder: &Path, picks: &[(String, String, Option<String>)], from: Option<&str>, login: &str) -> Result<SyncResult> {
    resolve_from(folder, picks, login, true, from)
}

fn resolve_inner(folder: &Path, picks: &[(String, String, Option<String>)], login: &str, send: bool) -> Result<SyncResult> {
    resolve_from(folder, picks, login, send, None)
}

/// 下書きに本体（main）の最新を取り込む。ぶつかったら Conflict を返す（解決画面で from=main として解決）。
pub fn update_from_main(folder: &Path, main: &str, login: &str) -> Result<SyncResult> {
    let repo = Repository::open(folder)?;
    let n = changes_of(&repo)?.len();
    if n > 0 {
        return Ok(SyncResult::NeedSave { changes: n });
    }
    fetch(&repo, &crate::github::token()?)?;
    let head = repo.head()?.peel_to_commit()?.id();
    let up = repo.refname_to_id(&format!("refs/remotes/origin/{main}"))?;
    if head == up || repo.graph_descendant_of(head, up)? {
        return Ok(SyncResult::Done { received: 0, sent: 0 });
    }
    let c = conflicts_from(folder, Some(main))?;
    if !c.is_empty() {
        return Ok(SyncResult::Conflict { files: c.into_iter().map(|f| f.path).collect() });
    }
    resolve_from(folder, &[], login, true, Some(main))
}

fn resolve_from(folder: &Path, picks: &[(String, String, Option<String>)], login: &str, send: bool, from: Option<&str>) -> Result<SyncResult> {
    let repo = Repository::open(folder)?;
    let n = changes_of(&repo)?.len();
    if n > 0 {
        return Ok(SyncResult::NeedSave { changes: n });
    }
    let token = crate::github::token()?;
    fetch(&repo, &token)?;
    let (mut idx, head, up, branch) = merge_index(&repo, from)?;
    let list: Vec<_> = idx.conflicts()?.collect::<std::result::Result<Vec<_>, _>>()?;
    for c in list {
        let path = match c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref()) {
            Some(e) => String::from_utf8_lossy(&e.path).to_string(),
            None => continue,
        };
        let Some((_, how, text)) = picks.iter().find(|(p, ..)| *p == path) else {
            return user("ぶつかっているファイルすべてについて、どちらを残すか選んでください");
        };
        idx.remove_path(Path::new(&path))?;
        let chosen = match how.as_str() {
            "mine" => c.our,
            "theirs" => c.their,
            _ => {
                let Some(mut e) = c.our.or(c.their).or(c.ancestor) else { continue };
                let body = text.as_deref().unwrap_or_default();
                if body.lines().any(|l| l.starts_with("<<<<<<<") || l.starts_with(">>>>>>>") || l == "=======" || l.starts_with("======= ")) {
                    return user("「<<<<<<<」などの衝突の印が残っています。取り除いてから送ってください");
                }
                e.id = repo.blob(body.as_bytes())?;
                e.file_size = body.len() as u32;
                e.mode = if e.mode == 0 { 0o100644 } else { e.mode };
                Some(e)
            }
        };
        if let Some(mut e) = chosen {
            e.flags &= !0x3000; // 衝突の段（stage）を外して通常の項目にする
            idx.add(&e)?;
        }
    }
    if idx.has_conflicts() {
        return user("ぶつかっているファイルすべてについて、どちらを残すか選んでください");
    }
    let tree = repo.find_tree(idx.write_tree_to(&repo)?)?;
    let sig = signature(&repo, login)?;
    let (h, u) = (repo.find_commit(head)?, repo.find_commit(up)?);
    let id = repo.commit(None, &sig, &sig, &format!("Merge remote-tracking branch 'origin/{}'", from.unwrap_or(&branch)), &tree, &[&h, &u])?;
    repo.reference(&format!("refs/heads/{branch}"), id, true, "resolve conflicts")?;
    repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
    if send {
        push(&repo, &branch, &token)?;
    }
    let behind = repo.graph_ahead_behind(head, up)?.1;
    Ok(SyncResult::Done { received: behind, sent: usize::from(send) })
}

fn merge_or_conflict(folder: &Path, login: &str, send: bool) -> Result<SyncResult> {
    let c = conflicts(folder)?;
    if c.is_empty() {
        return resolve_inner(folder, &[], login, send);
    }
    Ok(SyncResult::Conflict { files: c.into_iter().map(|f| f.path).collect() })
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
#[allow(dead_code)] // 以前の同期方式（積み直し）。今は merge で合わせる
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


// ---------- 履歴 ----------

#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    pub id: String,
    pub message: String,
    pub author: String,
    /// UNIX 秒
    pub time: i64,
    /// このPCだけにあり、まだ GitHub に送っていない
    pub local_only: bool,
    /// クラウドだけにあり、まだ取り込んでいない
    pub remote_only: bool,
    /// 親 commit（merge なら 2 つ）
    pub parents: Vec<String>,
    /// この commit を指している印（"HEAD"、"origin/main" など）
    pub refs: Vec<String>,
}

/// このフォルダの履歴保存の一覧（新しい順）。
pub fn history(folder: &Path, limit: usize) -> Result<Vec<HistoryEntry>> {
    let repo = Repository::open(folder)?;
    let branch = branch_of(folder)?;
    let remote = repo.refname_to_id(&format!("refs/remotes/origin/{branch}")).ok();
    let head = repo.head()?.peel_to_commit()?.id();
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    if let Some(r) = remote { walk.push(r)?; } // まだ取り込んでいないクラウド側の記録も並べる
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
    let mut out = vec![];
    for id in walk.take(limit) {
        let id = id?;
        let c = repo.find_commit(id)?;
        let local_only = match remote {
            Some(r) => r != id && !repo.graph_descendant_of(r, id).unwrap_or(false),
            None => true,
        };
        let remote_only = head != id && !repo.graph_descendant_of(head, id).unwrap_or(false);
        let mut refs = vec![];
        if id == head { refs.push("HEAD".to_string()); }
        if Some(id) == remote { refs.push(format!("origin/{branch}")); }
        out.push(HistoryEntry {
            id: id.to_string(),
            message: c.message().unwrap_or_default().trim().to_string(),
            author: c.author().name().unwrap_or_default().to_string(),
            time: c.time().seconds(),
            local_only,
            remote_only,
            parents: c.parent_ids().map(|p| p.to_string()).collect(),
            refs,
        });
    }
    Ok(out)
}

fn commit_and_parent_trees<'r>(repo: &'r Repository, id: &str) -> Result<(git2::Commit<'r>, git2::Tree<'r>, Option<git2::Tree<'r>>)> {
    let c = repo.find_commit(git2::Oid::from_str(id)?)?;
    let t = c.tree()?;
    let p = c.parent(0).ok().and_then(|p| p.tree().ok());
    Ok((c, t, p))
}

/// その履歴保存で変わったファイル。
pub fn history_files(folder: &Path, id: &str) -> Result<Vec<Change>> {
    let repo = Repository::open(folder)?;
    let (_, t, p) = commit_and_parent_trees(&repo, id)?;
    let diff = repo.diff_tree_to_tree(p.as_ref(), Some(&t), None)?;
    Ok(diff.deltas().map(|d| {
        let kind = match d.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Renamed => "renamed",
            _ => "modified",
        };
        let path = d.new_file().path().or_else(|| d.old_file().path()).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        Change { path, kind: kind.into() }
    }).collect())
}

/// その履歴保存での、1ファイルの変更点。
pub fn history_diff(folder: &Path, id: &str, rel: &str) -> Result<Option<String>> {
    let repo = Repository::open(folder)?;
    let (_, t, p) = commit_and_parent_trees(&repo, id)?;
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(rel).disable_pathspec_match(true).context_lines(3);
    let diff = repo.diff_tree_to_tree(p.as_ref(), Some(&t), Some(&mut opts))?;
    let mut out = String::new();
    let mut binary = false;
    diff.print(git2::DiffFormat::Patch, |delta, _, line| {
        if delta.flags().is_binary() { binary = true; return true; }
        // ファイル見出し（diff --git・index・---・+++）は出さない。日本語名が \350… のように化けるため
        if line.origin() == 'F' { return true; }
        if matches!(line.origin(), '+' | '-' | ' ') { out.push(line.origin()); }
        out.push_str(&String::from_utf8_lossy(line.content()));
        out.len() < 2_000_000
    })?;
    if binary { return Ok(None); }
    Ok(Some(out))
}

/// 1つのファイルを、その履歴保存の時点の中身に戻す（その時点で無かったファイルは消す）。
/// 戻した結果は「履歴未保存の変更」になるので、いつでも元に戻せる。
pub fn restore_file(folder: &Path, id: &str, rel: &str) -> Result<()> {
    let repo = Repository::open(folder)?;
    let (_, t, _) = commit_and_parent_trees(&repo, id)?;
    let dest = folder.join(rel);
    match t.get_path(Path::new(rel)) {
        Ok(e) => {
            let blob = repo.find_blob(e.id())?;
            if let Some(d) = dest.parent() { std::fs::create_dir_all(d)?; }
            std::fs::write(&dest, blob.content())?;
        }
        Err(_) => {
            if dest.exists() { trash::delete(&dest).map_err(|e| ProjError::User(format!("ごみ箱へ移せませんでした：{e}")))?; }
        }
    }
    Ok(())
}

/// フォルダ全体を、その履歴保存の時点の状態に戻す。
/// 後の履歴は消さず、「この時点に戻した」という新しい履歴保存を追加する。
pub fn restore_all(folder: &Path, id: &str, login: &str) -> Result<String> {
    let repo = Repository::open(folder)?;
    if !changes_of(&repo)?.is_empty() {
        return user("履歴未保存の変更があります。先に履歴保存するか、元に戻してください。");
    }
    let (c, t, _) = commit_and_parent_trees(&repo, id)?;
    let head = repo.head()?.peel_to_commit()?;
    if head.tree_id() == t.id() {
        return user("すでにこの時点と同じ状態です");
    }
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.checkout_tree(t.as_object(), Some(&mut co))?;
    let mut index = repo.index()?;
    index.read_tree(&t)?;
    index.write()?;
    let when = c.time().seconds();
    let label = c.message().unwrap_or_default().lines().next().unwrap_or_default().to_string();
    let sig = signature(&repo, login)?;
    let msg = format!("「{label}」の時点に戻す\n\n戻した先: {} ({when})", &id[..id.len().min(7)]);
    let new = repo.commit(Some("HEAD"), &sig, &sig, &msg, &t, &[&head])?;
    Ok(new.to_string())
}
