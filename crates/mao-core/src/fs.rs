//! 通常のファイラー操作（Git に依存しない）。
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("ごみ箱へ移動できませんでした: {0}")]
    Trash(#[from] trash::Error),
    #[error("{0}")]
    User(String),
}
pub type Result<T> = std::result::Result<T, FsError>;

#[derive(Debug, Clone, Serialize)]
pub struct Place {
    pub name: String,
    pub path: PathBuf,
    /// "quick" | "drive"
    pub kind: String,
}

/// クイックアクセスとドライブ。
pub fn places() -> Vec<Place> {
    let mut out = vec![];
    let quick = [
        ("デスクトップ", dirs::desktop_dir()),
        ("ダウンロード", dirs::download_dir()),
        ("ドキュメント", dirs::document_dir()),
        ("ピクチャ", dirs::picture_dir()),
        ("ホーム", dirs::home_dir()),
    ];
    for (n, p) in quick {
        if let Some(p) = p.filter(|p| p.exists()) {
            out.push(Place { name: n.into(), path: p, kind: "quick".into() });
        }
    }
    #[cfg(windows)]
    for c in b'A'..=b'Z' {
        let p = PathBuf::from(format!("{}:\\", c as char));
        let present = unsafe { windows_sys::Win32::Storage::FileSystem::GetLogicalDrives() } & (1 << (c - b'A')) != 0;
        if !present { continue; }
        let (remote, label) = win_drive(&p);
        let unc = if remote { win_unc(c as char) } else { String::new() };
        if remote && unc.to_lowercase().contains("wsl") {
            out.push(Place { name: format!("Linux ({}:)", c as char), path: p, kind: "drive".into() });
            continue;
        }
        if !remote && !p.exists() { continue; }
        let letter = c as char;
        // パソコン版 Google ドライブは「Google Drive」という名前の仮想ドライブになる
        let gdrive = label.eq_ignore_ascii_case("Google Drive") || p.join("My Drive").exists() || p.join("マイドライブ").exists();
        if gdrive {
            // 「ミラーリング」設定だと、マイドライブの実体はホームフォルダにあり、G: にはショートカットだけが置かれる
            if let Some(h) = dirs::home_dir() {
                for sub in ["マイドライブ", "My Drive"] {
                    if h.join(sub).is_dir() { out.push(Place { name: sub.into(), path: h.join(sub), kind: "gdrive".into() }); }
                }
            }
            for sub in ["マイドライブ", "My Drive", "共有ドライブ", "Shared drives", "他のパソコン", "Other computers"] {
                if p.join(sub).exists() { out.push(Place { name: sub.into(), path: p.join(sub), kind: "gdrive".into() }); }
            }
            if !out.iter().any(|x| x.kind == "gdrive") { out.push(Place { name: format!("Google ドライブ ({letter}:)"), path: p, kind: "gdrive".into() }); }
        } else if remote {
            let n = match unc.trim_start_matches('\\').split_once('\\') {
                Some((host, share)) => format!("{share} - {host} ({letter}:)"),
                None if !label.is_empty() => format!("{label} ({letter}:)"),
                None => format!("ネットワーク ({letter}:)"),
            };
            out.push(Place { name: n, path: p, kind: "nas".into() });
        } else {
            out.push(Place { name: format!("ドライブ ({letter}:)"), path: p, kind: "drive".into() });
        }
    }
    // OneDrive（個人用・職場用）。PCに同期されたフォルダーを使う。
    let mut od: Vec<PathBuf> = vec![];
    for v in ["OneDriveConsumer", "OneDriveCommercial", "OneDrive"] {
        if let Some(p) = std::env::var_os(v).map(PathBuf::from) { od.push(p); }
    }
    if let Some(h) = dirs::home_dir() {
        for base in [h.clone(), h.join("Library").join("CloudStorage")] {
            if let Ok(rd) = std::fs::read_dir(&base) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().to_string();
                    let p = e.path();
                    if n.starts_with("OneDrive") && p.is_dir() { od.push(p); }
                    else if n.starts_with("GoogleDrive") && p.is_dir() {
                        out.push(Place { name: n.trim_start_matches("GoogleDrive-").into(), path: p, kind: "gdrive".into() });
                    }
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    for p in od {
        if !p.is_dir() || !seen.insert(p.to_string_lossy().to_lowercase()) { continue; }
        let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let n = match n.split_once(" - ").or_else(|| n.split_once('-')) { Some((_, org)) => org.trim().to_string(), None => "個人用".into() };
        out.push(Place { name: n, path: p, kind: "onedrive".into() });
    }
    #[cfg(not(windows))]
    {
        out.push(Place { name: "コンピュータ".into(), path: "/".into(), kind: "drive".into() });
        if let Ok(rd) = std::fs::read_dir("/Volumes") {
            for e in rd.flatten() {
                out.push(Place { name: e.file_name().to_string_lossy().into(), path: e.path(), kind: "drive".into() });
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub hidden: bool,
}

fn is_hidden(name: &str, md: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if md.file_attributes() & 0x2 != 0 {
            return true;
        }
    }
    let _ = md;
    name.starts_with('.')
}

/// プレビュー用にテキストを読む。大きすぎる・文字でないファイルは None。
pub fn read_text(path: &Path, max: u64) -> Result<Option<String>> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() || meta.len() > max {
        return Ok(None);
    }
    let bytes = std::fs::read(path)?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Ok(None);
    }
    Ok(String::from_utf8(bytes).ok())
}

pub fn list(dir: &Path, show_hidden: bool) -> Result<Vec<Entry>> {
    let mut out = vec![];
    for e in std::fs::read_dir(dir)? {
        let Ok(e) = e else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let Ok(md) = e.metadata() else { continue };
        let hidden = is_hidden(&name, &md);
        if hidden && !show_hidden {
            continue;
        }
        out.push(Entry {
            name,
            path: e.path(),
            is_dir: md.is_dir(),
            size: if md.is_dir() { 0 } else { md.len() },
            modified: md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()),
            hidden,
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// 同名があれば「名前 (2)」のように避ける。
fn unique(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

fn check_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err(FsError::User("ファイル名に次の文字は使えません: \\ / : * ? \" < > |".into()));
    }
    Ok(())
}

pub fn new_folder(dir: &Path, name: &str) -> Result<PathBuf> {
    check_name(name)?;
    let p = unique(dir, name);
    std::fs::create_dir(&p)?;
    Ok(p)
}

pub fn new_file(dir: &Path, name: &str) -> Result<PathBuf> {
    check_name(name)?;
    let p = unique(dir, name);
    std::fs::File::create(&p)?;
    Ok(p)
}

pub fn rename(path: &Path, new_name: &str) -> Result<PathBuf> {
    check_name(new_name)?;
    let to = path.with_file_name(new_name);
    if to.exists() && to != path {
        return Err(FsError::User("同じ名前の項目がすでにあります".into()));
    }
    std::fs::rename(path, &to)?;
    Ok(to)
}

/// ごみ箱へ移動（完全削除はしない）。
pub fn delete(paths: &[PathBuf]) -> Result<()> {
    trash::delete_all(paths)?;
    Ok(())
}

fn copy_rec(from: &Path, to: &Path) -> Result<()> {
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for e in std::fs::read_dir(from)? {
            let e = e?;
            copy_rec(&e.path(), &to.join(e.file_name()))?;
        }
    } else {
        std::fs::copy(from, to)?;
    }
    Ok(())
}

pub fn copy(paths: &[PathBuf], dest: &Path) -> Result<Vec<PathBuf>> {
    let mut out = vec![];
    for p in paths {
        if dest.starts_with(p) {
            return Err(FsError::User("フォルダをその中にはコピーできません".into()));
        }
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let to = unique(dest, &name);
        copy_rec(p, &to)?;
        out.push(to);
    }
    Ok(out)
}

pub fn move_to(paths: &[PathBuf], dest: &Path) -> Result<Vec<PathBuf>> {
    let mut out = vec![];
    for p in paths {
        if dest.starts_with(p) {
            return Err(FsError::User("フォルダをその中には移動できません".into()));
        }
        if p.parent() == Some(dest) {
            out.push(p.clone());
            continue;
        }
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let to = unique(dest, &name);
        if std::fs::rename(p, &to).is_err() {
            // 別ドライブ間はコピーしてから元をごみ箱へ
            copy_rec(p, &to)?;
            trash::delete(p)?;
        }
        out.push(to);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_ops() {
        let d = std::env::temp_dir().join(format!("mao-fs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let f = new_file(&d, "メモ.txt").unwrap();
        let f2 = new_file(&d, "メモ.txt").unwrap();
        assert!(f2.ends_with("メモ (2).txt"));
        let sub = new_folder(&d, "新しいフォルダー").unwrap();
        let c = copy(&[f.clone()], &sub).unwrap();
        assert!(c[0].exists());
        let m = move_to(&[f2.clone()], &sub).unwrap();
        assert!(m[0].exists() && !f2.exists());
        let r = rename(&f, "改名.txt").unwrap();
        assert!(r.exists());
        assert!(copy(&[sub.clone()], &sub).is_err());
        assert!(rename(&r, "a/b").is_err());
        let names: Vec<_> = list(&d, false).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["新しいフォルダー", "改名.txt"]);
        let _ = std::fs::remove_dir_all(&d);
    }
}

/// (ネットワークドライブか, ボリューム名)
#[cfg(windows)]
fn win_drive(root: &std::path::Path) -> (bool, String) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumeInformationW};
    let w: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut name = [0u16; 261];
    unsafe {
        let remote = GetDriveTypeW(w.as_ptr()) == 4; // DRIVE_REMOTE
        let ok = GetVolumeInformationW(w.as_ptr(), name.as_mut_ptr(), name.len() as u32,
            std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0);
        let len = name.iter().position(|&c| c == 0).unwrap_or(0);
        (remote, if ok != 0 { String::from_utf16_lossy(&name[..len]) } else { String::new() })
    }
}

/// ネットワークドライブの元のアドレス（\nas\share）。
#[cfg(windows)]
fn win_unc(letter: char) -> String {
    use windows_sys::Win32::NetworkManagement::WNet::WNetGetConnectionW;
    let local: Vec<u16> = format!("{letter}:").encode_utf16().chain(Some(0)).collect();
    let mut buf = [0u16; 512];
    let mut len = buf.len() as u32;
    let r = unsafe { WNetGetConnectionW(local.as_ptr(), buf.as_mut_ptr(), &mut len) };
    if r != 0 { return String::new(); }
    let n = buf.iter().position(|&c| c == 0).unwrap_or(0);
    String::from_utf16_lossy(&buf[..n])
}
