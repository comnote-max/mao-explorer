/**
 * ブラウザで画面だけ試すための偽バックエンド（開発用）。
 * Tauri の外（普通のブラウザ）で `?mock` を付けて開いたときだけ有効になる。
 * 中身はすべてメモリ上の作り物で、PC や GitHub には一切触れない。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const enabled = !("__TAURI_INTERNALS__" in window) && new URLSearchParams(location.search).has("mock");

if (enabled) {
  const S = "\\";
  const now = () => Math.floor(Date.now() / 1000);
  type Node = { dir: boolean; text: string; modified: number };
  const fs = new Map<string, Node>();
  const norm = (p: string) => (p.length > 3 && p.endsWith(S) ? p.slice(0, -1) : p);
  const parent = (p: string) => { const i = norm(p).lastIndexOf(S); const r = p.slice(0, i); return r.length === 2 ? r + S : r; };
  const base = (p: string) => norm(p).split(S).pop()!;
  const mkdir = (p: string) => { p = norm(p); if (fs.has(p)) return; if (p.length > 3) mkdir(parent(p)); fs.set(p, { dir: true, text: "", modified: now() }); };
  const write = (p: string, text: string) => { mkdir(parent(p)); fs.set(p, { dir: false, text, modified: now() }); };
  const kids = (p: string) => { p = norm(p); const pre = p.endsWith(S) ? p : p + S; return [...fs.keys()].filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes(S) && k !== p); };
  const rmrf = (p: string) => { p = norm(p); for (const k of [...fs.keys()]) if (k === p || k.startsWith(p + S)) fs.delete(k); };
  const copyTree = (from: string, to: string) => { for (const [k, v] of [...fs.entries()]) if (k === from || k.startsWith(from + S)) fs.set(to + k.slice(from.length), { ...v }); };

  const HOME = "C:\\Users\\demo";
  for (const d of ["Desktop", "Downloads", "Documents", "Pictures"]) mkdir(`${HOME}\\${d}`);
  write(`${HOME}\\Documents\\メモ.txt`, "買い物リスト\n・牛乳\n・パン");
  write(`${HOME}\\Desktop\\請求書_10月.txt`, "請求書 10月分\n合計 120,000円");
  write(`${HOME}\\Downloads\\資料.txt`, "会議資料");
  mkdir("D:\\");

  // ---- GitHub 側（作り物） ----
  type Proj = { full_name: string; name: string; owner: string; private: boolean; description: string | null; default_branch: string; access: string; updated_at: string };
  const projects: Proj[] = [
    { full_name: "neko/mitsumori", name: "mitsumori", owner: "neko", private: true, description: "【見積書】お客様向け見積書のひな形", default_branch: "main", access: "admin", updated_at: "2026-11-10T09:00:00Z" },
    { full_name: "tanaka/team-docs", name: "team-docs", owner: "tanaka", private: true, description: "【チーム資料】田中さんから共有された資料", default_branch: "main", access: "write", updated_at: "2026-11-15T12:00:00Z" },
  ];
  const remote: Record<string, Record<string, string>> = {
    "neko/mitsumori": { "README.md": "# 見積書\n\nお客様向け見積書のひな形です。", "見積書_A社.txt": "見積書 A社\n品目: 制作費\n金額: 300,000円", "ひな形/見積書テンプレート.txt": "見積書\n品目:\n金額:" },
    "tanaka/team-docs": { "README.md": "# チーム資料\n\n毎週の議事録を置きます。", "議事録_1110.txt": "11/10 定例\n・予算の確認", "議事録_1117.txt": "11/17 定例\n・来月の予定" },
  };
  type Hist = { id: string; message: string; author: string; time: number; local_only: boolean; snap: Record<string, string> };
  const remoteHist: Record<string, Hist[]> = {};
  const sha = () => Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  for (const fn of Object.keys(remote)) remoteHist[fn] = [{ id: sha(), message: "最初の保存", author: fn.split("/")[0], time: now() - 86400 * 7, local_only: false, snap: { ...remote[fn] } }];

  // ---- PC に取り込んだプロジェクト ----
  type Loc = { full_name: string; main: string; drafts: Record<string, string> };
  const local: Record<string, Loc> = {};
  type FState = { saved: Record<string, string>; ahead: number; branch: string; is_main: boolean; full_name: string; hist: Hist[]; published: boolean };
  const folders: Record<string, FState> = {};
  let masterDir = "C:\\GitHub";
  const requests: Record<string, any[]> = { "neko/mitsumori": [], "tanaka/team-docs": [] };
  let reqNo = 1;
  const invites: Record<string, any[]> = {};
  let loggedIn = false;
  let polls = 0;
  const me = { login: "neko", name: "猫大好き", avatar_url: "" };

  const snapshot = (dir: string) => {
    const out: Record<string, string> = {};
    for (const [k, v] of fs) if (!v.dir && k.startsWith(dir + S)) out[k.slice(dir.length + 1).split(S).join("/")] = v.text;
    return out;
  };
  const restore = (dir: string, snap: Record<string, string>) => { rmrf(dir); mkdir(dir); for (const [r, t] of Object.entries(snap)) write(dir + S + r.split("/").join(S), t); };
  const changesOf = (dir: string) => {
    const f = folders[dir]; const cur = snapshot(dir); const out: { path: string; kind: string }[] = [];
    for (const r of Object.keys(cur)) if (!(r in f.saved)) out.push({ path: r, kind: "added" }); else if (cur[r] !== f.saved[r]) out.push({ path: r, kind: "modified" });
    for (const r of Object.keys(f.saved)) if (!(r in cur)) out.push({ path: r, kind: "deleted" });
    return out;
  };
  const folderOf = (p: string) => Object.keys(folders).filter((d) => p === d || p.startsWith(d + S)).sort((a, b) => b.length - a.length)[0];
  const view = (p: Proj) => { const l = local[p.full_name]; return { ...p, synced: !!l, root: l ? `${masterDir}\\.mao-drafts\\${p.name}` : null, main: l?.main ?? null }; };
  const stateOf = (dir: string) => {
    const f = folders[dir]; const main = folders[local[f.full_name].main];
    const behind = f.is_main ? Math.max(0, remoteHist[f.full_name].length - f.hist.filter((h) => !h.local_only).length) : 0;
    const notInMain = f.is_main ? 0 : f.hist.filter((h) => !main.hist.some((m) => m.id === h.id)).length;
    return { changes: changesOf(dir).length, ahead: f.ahead, behind, unpublished: !f.published, not_in_main: notInMain };
  };
  const folderView = (dir: string) => ({ name: folders[dir].is_main ? "本体" : base(dir), path: dir, branch: folders[dir].branch, is_main: folders[dir].is_main, state: stateOf(dir) });
  const err = (m: string) => { throw m; };

  const H: Record<string, (a: any) => any> = {
    auth_account: () => (loggedIn ? me : null),
    login_start: () => { polls = 0; return { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 2 }; },
    login_poll: () => (++polls >= 2 ? ((loggedIn = true), { state: "success" }) : { state: "pending" }),
    logout: () => { loggedIn = false; },
    "plugin:opener|open_url": () => null,
    "plugin:event|listen": () => 1,
    "plugin:event|unlisten": () => null,

    fs_places: () => [
      { name: "デスクトップ", path: `${HOME}\\Desktop`, kind: "quick" }, { name: "ダウンロード", path: `${HOME}\\Downloads`, kind: "quick" },
      { name: "ドキュメント", path: `${HOME}\\Documents`, kind: "quick" }, { name: "ピクチャ", path: `${HOME}\\Pictures`, kind: "quick" },
      { name: "ホーム", path: HOME, kind: "quick" }, { name: "ドライブ (C:)", path: "C:\\", kind: "drive" }, { name: "ドライブ (D:)", path: "D:\\", kind: "drive" },
    ],
    fs_list: ({ path }) => { if (!fs.get(norm(path))?.dir && !/^[A-Z]:\\$/.test(path)) err("読み込めません"); return kids(path).filter((k) => base(k) !== ".mao-drafts").map((k) => { const n = fs.get(k)!; return { name: base(k), path: k, is_dir: n.dir, size: n.text.length * 2, modified: n.modified, hidden: false }; }); },
    fs_read_text: ({ path }) => fs.get(path)?.text ?? null,
    fs_new_folder: ({ dir, name }) => { const p = dir.replace(/\\$/, "") + S + name; if (fs.has(p)) err("同じ名前の項目がすでにあります"); mkdir(p); return p; },
    fs_new_file: ({ dir, name }) => { const p = dir.replace(/\\$/, "") + S + name; if (fs.has(p)) err("同じ名前の項目がすでにあります"); write(p, ""); return p; },
    fs_rename: ({ path, name }) => { const to = parent(path).replace(/\\$/, "") + S + name; if (fs.has(to)) err("同じ名前の項目がすでにあります"); copyTree(path, to); rmrf(path); return to; },
    fs_delete: ({ paths }) => { for (const p of paths) rmrf(p); },
    fs_copy: ({ paths, dest }) => paths.map((p: string) => { let to = dest.replace(/\\$/, "") + S + base(p); while (fs.has(to)) to = to.replace(/(\.[^.\\]+)?$/, " - コピー$1"); copyTree(p, to); return to; }),
    fs_move: ({ paths, dest }) => paths.map((p: string) => { const to = dest.replace(/\\$/, "") + S + base(p); copyTree(p, to); rmrf(p); return to; }),
    fs_open: ({ path }) => new Promise<void>((done) => {
      const n = fs.get(path); if (!n || n.dir) return done();
      // メモ帳の代わり：画面の上に編集欄を出す
      const box = document.createElement("div");
      box.setAttribute("style", "position:fixed;inset:10% 20%;background:#fff;border:2px solid #555;z-index:99999;display:flex;flex-direction:column;padding:8px;gap:6px;font:14px sans-serif;box-shadow:0 8px 30px #0006");
      box.innerHTML = `<div>📝 メモ帳 — ${base(path)}</div><textarea aria-label="メモ帳の本文" style="flex:1;font:14px monospace"></textarea><div style="display:flex;gap:6px;justify-content:flex-end"><button data-k="cancel">保存しないで閉じる</button><button data-k="save">上書き保存して閉じる</button></div>`;
      const ta = box.querySelector("textarea")!; ta.value = n.text;
      box.addEventListener("click", (e) => { const k = (e.target as HTMLElement).dataset.k; if (!k) return; if (k === "save") write(path, ta.value); box.remove(); done(); });
      document.body.appendChild(box); ta.focus();
    }),
    fs_reveal: () => null,

    projects: () => projects.map(view).sort((a, b) => Number(b.synced) - Number(a.synced)),
    project_info: ({ fullName }) => view(projects.find((p) => p.full_name === fullName)!),
    create_project: ({ name, private: priv, description }) => {
      const p: Proj = { full_name: `neko/${name}`, name, owner: "neko", private: priv, description, default_branch: "main", access: "admin", updated_at: new Date().toISOString() };
      projects.unshift(p); remote[p.full_name] = { "README.md": `# ${description?.match(/^【(.+?)】/)?.[1] ?? name}` }; remoteHist[p.full_name] = [{ id: sha(), message: "最初の保存", author: "neko", time: now(), local_only: false, snap: { ...remote[p.full_name] } }]; requests[p.full_name] = [];
      return view(p);
    },
    set_private: ({ fullName, private: priv }) => { const p = projects.find((x) => x.full_name === fullName)!; p.private = priv; return view(p); },
    members: ({ fullName }) => [{ login: "neko", avatar_url: "", role: fullName.startsWith("neko/") ? "admin" : "write" }, ...(fullName.startsWith("tanaka/") ? [{ login: "tanaka", avatar_url: "", role: "admin" }] : [])],
    invites: ({ fullName }) => invites[fullName] ?? [],
    invite: ({ fullName, login, role }) => { (invites[fullName] ??= []).push({ id: Date.now(), login, avatar_url: "", role }); return true; },
    cancel_invite: ({ fullName, id }) => { invites[fullName] = (invites[fullName] ?? []).filter((i: any) => i.id !== id); },
    remove_member: () => null,
    capability: ({ fullName }) => fullName.startsWith("neko/") ? { mode: "direct", can_review: true, note: "管理者として本体に反映できます" } : { mode: "request", can_review: false, note: "本体は保護されています。責任者への依頼が必要です" },
    browse_remote: ({ fullName, path }) => {
      const pre = path ? path + "/" : ""; const seen = new Map<string, any>();
      for (const [r, t] of Object.entries(remote[fullName])) if (r.startsWith(pre)) { const rest = r.slice(pre.length); const top = rest.split("/")[0]; seen.set(top, { name: top, path: pre + top, is_dir: rest.includes("/"), size: rest.includes("/") ? 0 : t.length * 2 }); }
      return [...seen.values()].sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
    },
    read_remote: ({ fullName, path }) => remote[fullName][path] ?? null,
    readme: ({ fullName }) => remote[fullName]["README.md"] ?? null,
    default_root: ({ name }) => `${masterDir}\\${name}`,
    master_dir: () => masterDir,
    set_master_dir: ({ dir }) => { masterDir = dir; },
    open_in_desktop: () => false,
    first_sync: ({ fullName, defaultBranch, root }) => {
      if (fs.has(root) && kids(root).length) err(`保存先が空ではありません: ${root}`);
      restore(root, remote[fullName]);
      folders[root] = { saved: { ...remote[fullName] }, ahead: 0, branch: defaultBranch, is_main: true, full_name: fullName, hist: remoteHist[fullName].map((h) => ({ ...h })), published: true };
      local[fullName] = { full_name: fullName, main: root, drafts: {} };
      return root;
    },
    folders: ({ fullName }) => { const l = local[fullName]; if (!l) err("このプロジェクトはまだ同期されていません"); return [l.main, ...Object.values(l.drafts)].map(folderView); },
    create_folder: ({ fullName, name: raw, from }) => {
      const name = String(raw).trim().replace(/^mao\//, "").trim();
      const l = local[fullName]; const p = projects.find((x) => x.full_name === fullName)!;
      const dir = `${masterDir}\\.mao-drafts\\${p.name}\\${name}`; if (fs.has(dir)) err("同じ名前のフォルダがすでにあります");
      const src = folders[from ?? l.main]; restore(dir, { ...src.saved });
      folders[dir] = { saved: { ...src.saved }, ahead: 0, branch: "mao/" + name.replace(/[\s~^:?*[\\]/g, "-").replace(/\.\./g, "-"), is_main: false, full_name: fullName, hist: src.hist.map((h) => ({ ...h })), published: false };
      l.drafts[name] = dir; return folderView(dir);
    },
    remove_folder: ({ fullName, folder }) => { const l = local[fullName]; if (folder === l.main) err("本体は削除できません"); rmrf(folder); delete folders[folder]; for (const [k, v] of Object.entries(l.drafts)) if (v === folder) delete l.drafts[k]; },
    list_local: ({ folder, rel }) => {
      const dir = rel ? folder + S + rel.split("/").join(S) : folder; const ch = changesOf(folder);
      const out: any[] = kids(dir).map((k) => { const n = fs.get(k)!; const r = k.slice(folder.length + 1).split(S).join("/"); const c = ch.find((x) => x.path === r || x.path.startsWith(r + "/")); return { name: base(k), rel: r, is_dir: n.dir, size: n.text.length * 2, modified: n.modified, change: c ? (n.dir ? "modified" : c.kind) : null }; });
      for (const c of ch) if (c.kind === "deleted" && c.path.split("/").slice(0, -1).join("/") === (rel ?? "")) out.push({ name: c.path.split("/").pop()!, rel: c.path, is_dir: false, size: 0, modified: null, change: "deleted" });
      return out;
    },
    changes: ({ folder }) => changesOf(folderOf(folder) ?? folder),
    file_diff: ({ folder, rel }) => { const f = folders[folder]; const a = f?.saved[rel] ?? ""; const b = fs.get(folder + S + rel.split("/").join(S))?.text ?? ""; if (a === b) return null; return `--- 前回\n+++ 今\n${a.split("\n").map((l) => "-" + l).join("\n")}\n${b.split("\n").map((l) => "+" + l).join("\n")}`; },
    save: ({ folder, message, files }) => {
      const f = folders[folder]; if (!message?.trim()) err("履歴保存のメッセージを入力してください");
      const ch = changesOf(folder).filter((c) => !files?.length || files.includes(c.path)); if (!ch.length) err("履歴保存する変更がありません");
      const cur = snapshot(folder); for (const c of ch) { if (c.kind === "deleted") delete f.saved[c.path]; else f.saved[c.path] = cur[c.path]; }
      const id = Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""); f.hist.unshift({ id, message, author: "neko", time: now(), local_only: true, snap: { ...f.saved } }); f.ahead++; return id;
    },
    sync: ({ folder }) => {
      const f = folders[folder]; const ch = changesOf(folder).length; if (ch) return { result: "need_save", changes: ch };
      if (f.is_main && f.ahead > 0 && f.full_name.startsWith("tanaka/")) err("GitHubへの送信が拒否されました（protected branch）。本体へ直接書き込めない設定の可能性があります。");
      const sent = f.ahead; f.ahead = 0; f.published = true; f.hist.forEach((h) => (h.local_only = false));
      if (f.is_main) { remote[f.full_name] = { ...f.saved }; remoteHist[f.full_name] = f.hist.map((h) => ({ ...h })); }
      return { result: "done", received: 0, sent };
    },
    pull: ({ folder }) => { const ch = changesOf(folder).length; if (ch) return { result: "need_save", changes: ch }; return { result: "done", received: 0, sent: 0 }; },
    push: ({ folder }) => {
      const f = folders[folder];
      if (f.is_main && f.ahead > 0 && f.full_name.startsWith("tanaka/")) err("GitHubへの送信が拒否されました（protected branch）。本体へ直接書き込めない設定の可能性があります。");
      const sent = f.ahead || (f.published ? 0 : 1); f.ahead = 0; f.published = true; f.hist.forEach((h) => (h.local_only = false));
      if (f.is_main) { remote[f.full_name] = { ...f.saved }; remoteHist[f.full_name] = f.hist.map((h) => ({ ...h })); }
      return { result: "done", received: 0, sent };
    },
    move_to_draft: ({ fullName, name }) => {
      const l = local[fullName]; const m = folders[l.main];
      if (changesOf(l.main).length) H.save({ folder: l.main, message: "本体での変更（下書きへ移動）", files: [] });
      if (!m.ahead) err("移す変更がありません");
      const v = H.create_folder({ fullName, name, from: l.main }); const d = folders[v.path]; d.ahead = m.ahead;
      m.saved = { ...remote[fullName] }; restore(l.main, m.saved); m.hist = remoteHist[fullName].map((h) => ({ ...h })); m.ahead = 0;
      return folderView(v.path);
    },
    history: ({ folder }) => folders[folder]?.hist.map(({ snap, ...h }) => h) ?? [],
    history_files: ({ folder, id }) => { const f = folders[folder]; const i = f.hist.findIndex((h) => h.id === id); const a = f.hist[i + 1]?.snap ?? {}; const b = f.hist[i].snap; return Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).map((k) => ({ path: k, kind: !(k in a) ? "added" : !(k in b) ? "deleted" : "modified" })); },
    history_diff: ({ folder, id, rel }) => {
      const f = folders[folder]; const i = f.hist.findIndex((h) => h.id === id); const a = f.hist[i + 1]?.snap[rel]; const b = f.hist[i]?.snap[rel];
      const lines = (s: string | undefined, m: string) => (s === undefined ? [] : s.split("\n").map((l) => m + l));
      return `@@ -1 +1 @@\n${[...lines(a, "-"), ...lines(b, "+")].join("\n")}`;
    },
    restore_file: ({ folder, id, rel }) => { const h = folders[folder].hist.find((x) => x.id === id)!; const t = h.snap[rel]; const p = folder + S + rel.split("/").join(S); if (t === undefined) rmrf(p); else write(p, t); },
    restore_all: ({ folder, id }) => { if (changesOf(folder).length) err("履歴未保存の変更があります。先に履歴保存するか、元に戻してください。"); const h = folders[folder].hist.find((x) => x.id === id)!; restore(folder, h.snap); return H.save({ folder, message: `「${h.message}」の時点に戻す`, files: [] }); },
    requests: ({ fullName }) => ({ me: "neko", list: requests[fullName] ?? [] }),
    request_files: () => [],
    send_request: ({ fullName, folder, title, message }) => { const pf = folders[folder]; pf.ahead = 0; pf.published = true; pf.hist.forEach((h) => (h.local_only = false)); const n = reqNo++; requests[fullName].push({ number: n, title, body: message, author: "neko", head: folders[folder].branch, base: "main", created_at: new Date().toISOString(), url: "", mine: true, draft: false }); return n; },
    merge_folder: ({ fullName, folder }) => {
      const f = folders[folder]; const mainDir = local[fullName].main; const m = folders[mainDir];
      if (fullName.startsWith("tanaka/")) { const n = H.send_request({ fullName, folder, title: "反映依頼", message: "" }); return { result: "blocked", reason: "本体は保護されています。責任者への依頼が必要です", number: n }; }
      f.ahead = 0; f.published = true; f.hist.forEach((h) => (h.local_only = false));
      remote[fullName] = { ...f.saved }; m.saved = { ...f.saved }; restore(mainDir, f.saved); m.hist = f.hist.map((h) => ({ ...h, local_only: false })); remoteHist[fullName] = m.hist.map((h) => ({ ...h }));
      return { result: "merged" };
    },
    merge_request: () => ({ result: "merged" }),
    request_changes: () => null,
  };

  // alert / confirm はブラウザ操作を止めてしまうので、画面内の表示に置き換える（confirm は OK 扱い）
  const toast = (title: string, msg: string) => {
    const d = document.createElement("div");
    d.setAttribute("role", "alert");
    d.setAttribute("style", "position:fixed;left:50%;top:20px;transform:translateX(-50%);max-width:560px;background:#ffd;border:2px solid #aa8;z-index:99999;padding:10px 14px;white-space:pre-wrap;font:14px sans-serif;box-shadow:0 6px 20px #0004");
    d.textContent = `${title}\n${msg}`;
    const b = document.createElement("button"); b.textContent = "閉じる"; b.style.marginTop = "8px"; b.onclick = () => d.remove(); d.appendChild(document.createElement("br")); d.appendChild(b);
    document.body.appendChild(d);
  };
  window.alert = (m?: any) => toast("【お知らせ】", String(m ?? ""));
  window.confirm = (m?: any) => { toast("【確認画面が出て、OK を押しました】", String(m ?? "")); return true; };
  window.prompt = (m?: any, def?: string) => { toast("【入力画面（テストでは既定値のまま）】", String(m ?? "")); return def ?? ""; };
  let cb = 0;
  (window as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback: () => ++cb,
    convertFileSrc: (p: string) => "data:,",
    invoke: async (cmd: string, args: any) => {
      await new Promise((r) => setTimeout(r, 120));
      const h = H[cmd];
      if (!h) { console.warn("[mock] 未対応のコマンド", cmd, args); throw `（テスト用の偽環境では未対応: ${cmd}）`; }
      return h(args ?? {});
    },
  };
  console.info("[mock] 偽バックエンドで起動しました");
}
export {};
