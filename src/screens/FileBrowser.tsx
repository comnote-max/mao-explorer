import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { baseName, Change, Entry, fmtSize, fmtTime, fsApi, join, parentOf, sep } from "../api";
import { CHANGE_LABEL } from "../terms";

// アプリ全体で共有するクリップボード
let clipboard: { mode: "copy" | "cut"; paths: string[] } | null = null;

type Props = {
  /** 表示するフォルダ（変更されたら移動する） */
  path: string;
  onPathChange?: (p: string) => void;
  /** これより上には移動しない（プロジェクトのフォルダなど） */
  rootLimit?: string;
  /** アドレスバーの先頭に出す表示名（例：本体） */
  rootLabel?: string;
  /** Git の変更（root からの相対パス、/ 区切り） */
  gitRoot?: string;
  gitChanges?: Change[];
  /** ツールバー右側に追加する操作グループ */
  extraTools?: ReactNode;
  /** ステータスバーに追加する表示 */
  extraStatus?: ReactNode;
  /** ファイルに変更が起きたとき（Git の状態更新用） */
  onMutate?: () => void;
};

type Menu = { x: number; y: number; target: Entry | null };

export default function FileBrowser(p: Props) {
  const [path, setPath] = useState(p.path);
  const [back, setBack] = useState<string[]>([]);
  const [fwd, setFwd] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem("mao.hidden") === "1");
  const [addr, setAddr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: "name" | "modified" | "size"; asc: boolean }>({ key: "name", asc: true });
  const [, force] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (p.path !== path) go(p.path, false); }, [p.path]);

  const load = useCallback(async (quiet = false) => {
    try {
      const list = await fsApi.list(path, showHidden);
      setEntries(list);
      if (!quiet) setError(null);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    }
  }, [path, showHidden]);

  useEffect(() => { setEntries(null); load(); }, [load]);
  // 外部アプリでの変更を拾う
  useEffect(() => {
    const t = window.setInterval(() => document.hasFocus() && load(true), 2500);
    window.addEventListener("focus", () => load(true));
    return () => window.clearInterval(t);
  }, [load]);

  // OS からのドラッグ＆ドロップでコピー
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent(async (e) => {
      const pl = e.payload;
      if (pl.type !== "drop") return;
      await act(() => fsApi.copy(pl.paths, pathRef.current));
    });
    return () => { un.then((f) => f()); };
  }, []);

  const go = (to: string, record = true) => {
    if (p.rootLimit && !to.startsWith(p.rootLimit)) return;
    if (record) { setBack((b) => [...b, path]); setFwd([]); }
    setPath(to);
    setSel(new Set());
    setFilter("");
    p.onPathChange?.(to);
  };
  const up = () => {
    const par = parentOf(path);
    if (par && (!p.rootLimit || path !== p.rootLimit)) go(par);
  };

  const act = async (f: () => Promise<unknown>) => {
    try { await f(); setError(null); } catch (e) { setError(String(e)); }
    await load(true);
    p.onMutate?.();
  };

  // ---- Git の状態 ----
  const rel = (abs: string) =>
    p.gitRoot && abs.startsWith(p.gitRoot) ? abs.slice(p.gitRoot.length).replace(/^[\\/]/, "").split(sep).join("/") : null;
  const marks = useMemo(() => new Map((p.gitChanges ?? []).map((c) => [c.path, c.kind])), [p.gitChanges]);
  const markOf = (e: Entry) => {
    const r = rel(e.path);
    if (r === null) return null;
    if (!e.is_dir) return marks.get(r) ?? null;
    const pre = r + "/";
    for (const k of marks.keys()) if (k.startsWith(pre)) return "modified";
    return null;
  };
  const ghosts: Entry[] = useMemo(() => {
    const here = rel(path);
    if (here === null) return [];
    return (p.gitChanges ?? [])
      .filter((c) => c.kind === "deleted" && (c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : "") === here)
      .map((c) => ({ name: c.path.split("/").pop()!, path: join(path, c.path.split("/").pop()!), is_dir: false, size: 0, modified: null, hidden: false }));
  }, [p.gitChanges, path]);

  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    const list = [...(entries ?? []), ...ghosts].filter((e) => !f || e.name.toLowerCase().includes(f));
    const dir = sort.asc ? 1 : -1;
    return list.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      const v = sort.key === "name" ? a.name.localeCompare(b.name, "ja", { numeric: true })
        : sort.key === "size" ? a.size - b.size : (a.modified ?? 0) - (b.modified ?? 0);
      return v * dir;
    });
  }, [entries, ghosts, filter, sort]);

  const selected = shown.filter((e) => sel.has(e.path));

  // ---- 操作 ----
  const open = (e: Entry) => (e.is_dir ? go(e.path) : marks.get(rel(e.path) ?? "") === "deleted" ? null : act(() => fsApi.open(e.path)));
  const doCopy = (mode: "copy" | "cut") => { if (selected.length) { clipboard = { mode, paths: selected.map((e) => e.path) }; force((n) => n + 1); } };
  const doPaste = (dest = path) => {
    const c = clipboard;
    if (!c) return;
    if (c.mode === "cut") clipboard = null;
    return act(() => (c.mode === "copy" ? fsApi.copy(c.paths, dest) : fsApi.move(c.paths, dest)));
  };
  const doDelete = () => {
    if (!selected.length) return;
    const msg = selected.length === 1 ? `「${selected[0].name}」をごみ箱へ移動しますか？` : `${selected.length} 個の項目をごみ箱へ移動しますか？`;
    if (window.confirm(msg)) act(() => fsApi.remove(selected.map((e) => e.path)));
  };
  const createNew = async (kind: "folder" | "text") => {
    setNewMenu(false);
    try {
      const created = kind === "folder" ? await fsApi.newFolder(path, "新しいフォルダー") : await fsApi.newFile(path, "新しいテキスト ドキュメント.txt");
      await load(true);
      p.onMutate?.();
      setSel(new Set([created]));
      setRenaming(created);
    } catch (e) { setError(String(e)); }
  };
  const commitRename = (e: Entry, name: string) => {
    setRenaming(null);
    if (name && name !== e.name) act(() => fsApi.rename(e.path, name));
  };

  const click = (ev: React.MouseEvent, e: Entry) => {
    listRef.current?.focus();
    if (ev.ctrlKey || ev.metaKey) {
      const s = new Set(sel);
      s.has(e.path) ? s.delete(e.path) : s.add(e.path);
      setSel(s);
      setAnchor(e.path);
    } else if (ev.shiftKey && anchor) {
      const i = shown.findIndex((x) => x.path === anchor), j = shown.findIndex((x) => x.path === e.path);
      setSel(new Set(shown.slice(Math.min(i, j), Math.max(i, j) + 1).map((x) => x.path)));
    } else {
      setSel(new Set([e.path]));
      setAnchor(e.path);
    }
  };

  const key = (ev: React.KeyboardEvent) => {
    if (renaming || (ev.target as HTMLElement).tagName === "INPUT") return;
    const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
    if (mod && k === "a") { ev.preventDefault(); setSel(new Set(shown.map((e) => e.path))); }
    else if (mod && k === "c") doCopy("copy");
    else if (mod && k === "x") doCopy("cut");
    else if (mod && k === "v") doPaste();
    else if (mod && ev.shiftKey && k === "n") { ev.preventDefault(); createNew("folder"); }
    else if (k === "delete") doDelete();
    else if (k === "f2" && selected.length === 1) setRenaming(selected[0].path);
    else if (k === "f5") { ev.preventDefault(); load(); }
    else if (k === "enter" && selected.length === 1) open(selected[0]);
    else if (k === "backspace" || (ev.altKey && k === "arrowup")) up();
    else if (k === "arrowdown" || k === "arrowup") {
      ev.preventDefault();
      const i = shown.findIndex((e) => e.path === anchor);
      const n = shown[Math.max(0, Math.min(shown.length - 1, i + (k === "arrowdown" ? 1 : -1)))];
      if (n) { setSel(new Set([n.path])); setAnchor(n.path); }
    }
  };

  useEffect(() => {
    const close = () => { setMenu(null); setNewMenu(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // ---- アドレスバー ----
  const crumbs = (() => {
    const base = p.rootLimit ?? "";
    const restPath = base ? path.slice(base.length) : path;
    const parts = restPath.split(sep).filter(Boolean);
    const out: { label: string; to: string }[] = [];
    let acc = base;
    if (base) out.push({ label: p.rootLabel ?? baseName(base), to: base });
    for (const part of parts) {
      acc = acc ? join(acc, part) : part.endsWith(":") ? part + sep : sep + part;
      out.push({ label: part, to: acc });
    }
    return out;
  })();

  const sortBy = (k: "name" | "modified" | "size") => setSort((s) => ({ key: k, asc: s.key === k ? !s.asc : true }));
  const arrow = (k: string) => (sort.key === k ? (sort.asc ? " ▲" : " ▼") : "");

  return (
    <div className="browser" onKeyDown={key}>
      <div className="navbar">
        <button className="icon" title="戻る" disabled={!back.length} onClick={() => { const b = back[back.length - 1]; setBack(back.slice(0, -1)); setFwd([path, ...fwd]); go(b, false); }}>←</button>
        <button className="icon" title="進む" disabled={!fwd.length} onClick={() => { const f = fwd[0]; setFwd(fwd.slice(1)); setBack([...back, path]); go(f, false); }}>→</button>
        <button className="icon" title="上へ（Backspace）" onClick={up} disabled={!!p.rootLimit && path === p.rootLimit}>↑</button>
        <button className="icon" title="最新の情報に更新（F5）" onClick={() => load()}>↻</button>
        {addr === null ? (
          <div className="address" onClick={() => !p.rootLimit && setAddr(path)}>
            {crumbs.map((c, i) => (
              <span key={i}>{i > 0 && <span className="crumb-sep"> › </span>}
                <span className="crumb" onClick={(ev) => { ev.stopPropagation(); go(c.to); }}>{c.label}</span>
              </span>
            ))}
          </div>
        ) : (
          <input className="address" autoFocus value={addr} onChange={(e) => setAddr(e.target.value)}
            onBlur={() => setAddr(null)}
            onKeyDown={(e) => { if (e.key === "Enter") { go(addr); setAddr(null); } if (e.key === "Escape") setAddr(null); }} />
        )}
        <input className="search" placeholder={`🔍 ${baseName(path) || path} の中を絞り込み`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <div className="commandbar">
        <div className="dropdown">
          <button onClick={(e) => { e.stopPropagation(); setNewMenu(!newMenu); }}>⊕ 新規作成 ▾</button>
          {newMenu && (
            <div className="menu" style={{ top: "100%", left: 0 }}>
              <div onClick={() => createNew("folder")}>📁 フォルダー</div>
              <div onClick={() => createNew("text")}>📄 テキスト ドキュメント</div>
            </div>
          )}
        </div>
        <span className="sep" />
        <button className="icon" title="切り取り（Ctrl+X）" disabled={!selected.length} onClick={() => doCopy("cut")}>✂</button>
        <button className="icon" title="コピー（Ctrl+C）" disabled={!selected.length} onClick={() => doCopy("copy")}>⧉</button>
        <button className="icon" title="貼り付け（Ctrl+V）" disabled={!clipboard} onClick={() => doPaste()}>📋</button>
        <button className="icon" title="名前の変更（F2）" disabled={selected.length !== 1} onClick={() => setRenaming(selected[0].path)}>✏</button>
        <button className="icon" title="削除（Delete）" disabled={!selected.length} onClick={doDelete}>🗑</button>
        <span className="sep" />
        <label className="check"><input type="checkbox" checked={showHidden}
          onChange={(e) => { setShowHidden(e.target.checked); localStorage.setItem("mao.hidden", e.target.checked ? "1" : "0"); }} /> 隠しファイル</label>
        {p.extraTools && <><span className="sep" />{p.extraTools}</>}
      </div>

      {error && <div className="banner error">{error}<button className="small" onClick={() => setError(null)}>×</button></div>}

      <div className="files-scroll" ref={listRef} tabIndex={0}
        onClick={(e) => { if (e.target === e.currentTarget) setSel(new Set()); }}
        onContextMenu={(e) => { e.preventDefault(); if (e.target === e.currentTarget) { setSel(new Set()); setMenu({ x: e.clientX, y: e.clientY, target: null }); } }}>
        <table className="list">
          <thead>
            <tr>
              <th onClick={() => sortBy("name")}>名前{arrow("name")}</th>
              <th onClick={() => sortBy("modified")}>更新日時{arrow("modified")}</th>
              <th onClick={() => sortBy("size")} className="num">サイズ{arrow("size")}</th>
              {p.gitRoot && <th>状態</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const m = markOf(e);
              const cut = clipboard?.mode === "cut" && clipboard.paths.includes(e.path);
              return (
                <tr key={e.path}
                  className={(sel.has(e.path) ? "selected " : "") + (m === "deleted" ? "deleted " : "") + (cut || e.hidden ? "dim" : "")}
                  onClick={(ev) => { ev.stopPropagation(); click(ev, e); }}
                  onDoubleClick={() => open(e)}
                  onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (!sel.has(e.path)) setSel(new Set([e.path])); setMenu({ x: ev.clientX, y: ev.clientY, target: e }); }}>
                  <td className="name">
                    <span className="ficon">{e.is_dir ? "📁" : icon(e.name)}</span>
                    {renaming === e.path ? (
                      <RenameInput initial={e.name} onDone={(n) => commitRename(e, n)} />
                    ) : (
                      <span>{e.name}</span>
                    )}
                  </td>
                  <td className="muted">{fmtTime(e.modified)}</td>
                  <td className="muted num">{e.is_dir ? "" : fmtSize(e.size)}</td>
                  {p.gitRoot && <td>{m && <span className={`mark ${m}`}>● {CHANGE_LABEL[m] ?? m}</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {entries && shown.length === 0 && <p className="muted empty">{filter ? "一致する項目はありません" : "このフォルダーは空です"}</p>}
        {!entries && <p className="muted empty">読み込み中…</p>}
      </div>

      <div className="statusbar">
        {shown.length} 個の項目{selected.length ? `　${selected.length} 個を選択` : ""}
        {selected.length === 1 && !selected[0].is_dir ? `　${fmtSize(selected[0].size)}` : ""}
        {p.extraStatus && <>　｜　{p.extraStatus}</>}
      </div>

      {menu && (
        <div className="menu" style={{ top: menu.y, left: menu.x, position: "fixed" }} onClick={(e) => e.stopPropagation()}>
          {menu.target ? (
            <>
              <div onClick={() => { setMenu(null); open(menu.target!); }}><b>開く</b></div>
              <hr />
              <div onClick={() => { setMenu(null); doCopy("cut"); }}>✂ 切り取り</div>
              <div onClick={() => { setMenu(null); doCopy("copy"); }}>⧉ コピー</div>
              {menu.target.is_dir && clipboard && <div onClick={() => { setMenu(null); doPaste(menu.target!.path); }}>📋 このフォルダーに貼り付け</div>}
              <div className={selected.length !== 1 ? "disabled" : ""} onClick={() => { setMenu(null); selected.length === 1 && setRenaming(selected[0].path); }}>✏ 名前の変更</div>
              <div onClick={() => { setMenu(null); doDelete(); }}>🗑 削除</div>
              <hr />
              <div onClick={() => { setMenu(null); navigator.clipboard.writeText(selected.map((e) => e.path).join("\n")); }}>パスのコピー</div>
              <div onClick={() => { setMenu(null); fsApi.reveal(menu.target!.path); }}>OSのファイラーで表示</div>
            </>
          ) : (
            <>
              <div onClick={() => { setMenu(null); createNew("folder"); }}>📁 新しいフォルダー</div>
              <div onClick={() => { setMenu(null); createNew("text"); }}>📄 新しいテキスト ドキュメント</div>
              <hr />
              <div className={!clipboard ? "disabled" : ""} onClick={() => { setMenu(null); doPaste(); }}>📋 貼り付け</div>
              <div onClick={() => { setMenu(null); load(); }}>↻ 最新の情報に更新</div>
              <hr />
              <div onClick={() => { setMenu(null); fsApi.reveal(path); }}>OSのファイラーで表示</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, []);
  return (
    <input ref={ref} className="rename" defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.target.value.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone((e.target as HTMLInputElement).value.trim());
        if (e.key === "Escape") onDone(initial);
      }} />
  );
}

function icon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "🖼";
  if (["mp4", "mov", "avi", "mkv"].includes(ext)) return "🎞";
  if (["mp3", "wav", "flac", "m4a"].includes(ext)) return "🎵";
  if (["zip", "7z", "rar"].includes(ext)) return "🗜";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc", "docx"].includes(ext)) return "📘";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📗";
  if (["ppt", "pptx"].includes(ext)) return "📙";
  if (["exe", "msi", "bat", "cmd", "ps1"].includes(ext)) return "⚙";
  return "📄";
}
