import { invoke } from "@tauri-apps/api/core";

export type Access = "read" | "write" | "admin";
export type Project = {
  full_name: string; name: string; owner: string; private: boolean; description: string | null;
  default_branch: string; access: Access; updated_at: string; synced: boolean; root: string | null;
};
export type RemoteEntry = { name: string; path: string; is_dir: boolean; size: number };
export type FolderState = { changes: number; ahead: number; behind: number; unpublished: boolean; not_in_main: number };
export type Folder = { name: string; path: string; branch: string; is_main: boolean; state: FolderState };
export type LocalEntry = { name: string; rel: string; is_dir: boolean; size: number; modified: number | null; change: string | null };
export type Change = { path: string; kind: string };
export type SyncResult =
  | { result: "done"; received: number; sent: number }
  | { result: "need_save"; changes: number }
  | { result: "conflict"; files: string[] };
export type Capability = { mode: "none" | "request" | "direct"; can_review: boolean; note: string };
export type Request = {
  number: number; title: string; body: string; author: string; head: string; base: string;
  created_at: string; url: string; mine: boolean; draft: boolean;
};
export type ChangedFile = { path: string; status: string; additions: number; deletions: number; patch: string | null };
export type MergeView =
  | { result: "merged" }
  | { result: "blocked"; reason: string; number: number }
  | { result: "unverified"; number: number };

export type Place = { name: string; path: string; kind: "quick" | "drive" };
export type Entry = { name: string; path: string; is_dir: boolean; size: number; modified: number | null; hidden: boolean };

export const fsApi = {
  places: () => invoke<Place[]>("fs_places"),
  readText: (path: string) => invoke<string | null>("fs_read_text", { path }),
  list: (path: string, showHidden: boolean) => invoke<Entry[]>("fs_list", { path, showHidden }),
  newFolder: (dir: string, name: string) => invoke<string>("fs_new_folder", { dir, name }),
  newFile: (dir: string, name: string) => invoke<string>("fs_new_file", { dir, name }),
  rename: (path: string, name: string) => invoke<string>("fs_rename", { path, name }),
  remove: (paths: string[]) => invoke<void>("fs_delete", { paths }),
  copy: (paths: string[], dest: string) => invoke<string[]>("fs_copy", { paths, dest }),
  move: (paths: string[], dest: string) => invoke<string[]>("fs_move", { paths, dest }),
  open: (path: string) => invoke<void>("fs_open", { path }),
  reveal: (path: string) => invoke<void>("fs_reveal", { path }),
};

export const sep = navigator.userAgent.includes("Windows") ? "\\" : "/";
export const join = (dir: string, name: string) => (dir.endsWith(sep) ? dir + name : dir + sep + name);
export const parentOf = (p: string) => {
  const t = p.endsWith(sep) && p.length > 3 ? p.slice(0, -1) : p;
  const i = t.lastIndexOf(sep);
  if (i < 0) return null;
  const parent = t.slice(0, i);
  return parent.length === 2 && parent.endsWith(":") ? parent + sep : parent || "/";
};
export const baseName = (p: string) => p.split(sep).filter(Boolean).pop() ?? p;

export const api = {
  projects: () => invoke<Project[]>("projects"),
  setPrivate: (fullName: string, priv: boolean) => invoke<Project>("set_private", { fullName, private: priv }),
  projectInfo: (fullName: string) => invoke<Project>("project_info", { fullName }),
  capability: (fullName: string) => invoke<Capability>("capability", { fullName }),
  browseRemote: (fullName: string, path: string, gitRef: string) =>
    invoke<RemoteEntry[]>("browse_remote", { fullName, path, gitRef }),
  readRemote: (fullName: string, path: string, gitRef: string) =>
    invoke<string | null>("read_remote", { fullName, path, gitRef }),
  readme: (fullName: string) => invoke<string | null>("readme", { fullName }),
  defaultRoot: (name: string) => invoke<string>("default_root", { name }),
  firstSync: (fullName: string, defaultBranch: string, root: string) =>
    invoke<string>("first_sync", { fullName, defaultBranch, root }),
  folders: (fullName: string) => invoke<Folder[]>("folders", { fullName }),
  removeFolder: (fullName: string, folder: string, remote: boolean) => invoke<void>("remove_folder", { fullName, folder, remote }),
  createFolder: (fullName: string, name: string, from?: string) => invoke<Folder>("create_folder", { fullName, name, from: from ?? null }),
  listLocal: (folder: string, rel: string) => invoke<LocalEntry[]>("list_local", { folder, rel }),
  fileDiff: (folder: string, rel: string) => invoke<string | null>("file_diff", { folder, rel }),
  changes: (folder: string) => invoke<Change[]>("changes", { folder }),
  save: (folder: string, message: string, files: string[]) => invoke<string>("save", { folder, message, files }),
  sync: (folder: string) => invoke<SyncResult>("sync", { folder }),
  requests: (fullName: string) => invoke<{ me: string; list: Request[] }>("requests", { fullName }),
  requestFiles: (fullName: string, number: number) => invoke<ChangedFile[]>("request_files", { fullName, number }),
  sendRequest: (fullName: string, folder: string, title: string, message: string) =>
    invoke<number>("send_request", { fullName, folder, title, message }),
  mergeFolder: (fullName: string, folder: string, title: string) =>
    invoke<MergeView>("merge_folder", { fullName, folder, title }),
  mergeRequest: (fullName: string, number: number, base: string) =>
    invoke<MergeView>("merge_request", { fullName, number, base }),
  requestChanges: (fullName: string, number: number, message: string) =>
    invoke<void>("request_changes", { fullName, number, message }),
};

export const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const fmtTime = (s: number | null) => (s ? new Date(s * 1000).toLocaleString("ja-JP") : "");
