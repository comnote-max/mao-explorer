import type React from "react";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { baseName, Change, Entry, fmtSize, fmtTime, fsApi, join, parentOf, sep } from "../api";
import { CHANGE_LABEL } from "../terms";
import Preview from "./Preview";
import ColumnTable from "./ColumnTable";
import { dragProps, dropInto, dropProps, dropTargetAt } from "../dnd";
import { t , tErr } from "../i18n";

// アプリ全体で共有するクリップボード
let clipboard: { mode: "copy" | "cut"; paths: string[] } | null = null;
/** 貼り付け中は次の貼り付けを受け付けない（二重に貼られるのを防ぐ） */
let pasting = false;

type Props = {
  /** 表示するフォルダ（変更されたら移動する） */
  path: string;
  onPathChange?: (p: string) => void;
  /** これより上には移動しない（プロジェクトのフォルダなど） */
  rootLimit?: string;
  /** 自分の履歴がなくなった時の「戻る」と、rootLimit で「上へ」を押した時の行き先（外側の画面へ） */
  outerBack?: () => void;
  canOuterBack?: boolean;
  outerUp?: () => void;
  /** アドレスバーの先頭に出す表示名（例：本体） */
  rootLabel?: React.ReactNode;
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

type View = "details" | "medium" | "large";

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
  const [view, setView] = useState<View>(() => (localStorage.getItem("mao.view") as View) || "details");
  const [preview, setPreview] = useState(() => localStorage.getItem("mao.preview") === "1");
  const togglePreview = () => setPreview((v) => { try { localStorage.setItem("mao.preview", v ? "0" : "1"); } catch { /* 任意 */ } return !v; });
  const changeView = (v: View) => { setView(v); try { localStorage.setItem("mao.view", v); } catch { /* 任意 */ } };
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (p.path !== path) go(p.path, false); }, [p.path]);

  const load = useCallback(async (quiet = false) => {
    try {
      const list = await fsApi.list(path, showHidden);
      setEntries(list);
      if (!quiet) setError(null);
    } catch (e) {
      setError(tErr(e));
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
      // 落とした位置のフォルダ（ツリーや一覧のフォルダ）へ。何もない所なら今開いている場所へ
      const dest = dropTargetAt(pl.position.x, pl.position.y) ?? pathRef.current;
      await dropInto(dest, pl.paths, false);
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
    if (p.rootLimit && path === p.rootLimit) { p.outerUp?.(); return; }
    if (par) go(par); else p.outerUp?.();
  };
  const goBackNav = () => {
    if (!back.length) { if (p.canOuterBack) p.outerBack?.(); return; }
    const b = back[back.length - 1]; setBack(back.slice(0, -1)); setFwd([path, ...fwd]); go(b, false);
  };

  const act = async (f: () => Promise<unknown>) => {
    try { await f(); setError(null); } catch (e) { setError(tErr(e)); }
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
  const doPaste = async (dest = path) => {
    const c = clipboard;
    if (!c || pasting) return;
    pasting = true;
    if (c.mode === "cut") clipboard = null;
    try { await act(() => (c.mode === "copy" ? fsApi.copy(c.paths, dest) : fsApi.move(c.paths, dest))); }
    finally { pasting = false; }
  };
  // 一覧の外（ツリーなど）にカーソルがあっても Ctrl+C / X / V が効くように
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (ev: KeyboardEvent) => {
    const el = ev.target as HTMLElement;
    if (renaming || el.closest(".browser") || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
    if (!(ev.ctrlKey || ev.metaKey) || ev.repeat) return;
    const k = ev.key.toLowerCase();
    if (k === "v") { ev.preventDefault(); doPaste(); }
    else if (k === "c") doCopy("copy");
    else if (k === "x") doCopy("cut");
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    const r = () => { load(true); p.onMutate?.(); };
    window.addEventListener("keydown", h);
    window.addEventListener("mao:fs-changed", r);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("mao:fs-changed", r); };
  }, []);
  const doDelete = () => {
    if (!selected.length) return;
    const msg = selected.length === 1 ? t("「{0}」をごみ箱へ移動しますか？", [selected[0].name]) : t("{0} 個の項目をごみ箱へ移動しますか？", [selected.length]);
    if (window.confirm(msg)) act(() => fsApi.remove(selected.map((e) => e.path)));
  };
  const createNew = async (kind: "folder" | "text") => {
    setNewMenu(false);
    try {
      const created = kind === "folder" ? await fsApi.newFolder(path, t("新しいフォルダー")) : await fsApi.newFile(path, t("新しいテキスト ドキュメント.txt"));
      await load(true);
      p.onMutate?.();
      setSel(new Set([created]));
      setRenaming(created);
    } catch (e) { setError(tErr(e)); }
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
    if (ev.altKey && k === "p") { ev.preventDefault(); togglePreview(); }
    else if (mod && k === "a") { ev.preventDefault(); setSel(new Set(shown.map((e) => e.path))); }
    else if (mod && k === "c") doCopy("copy");
    else if (mod && k === "x") doCopy("cut");
    else if (mod && k === "v") { if (!ev.repeat) doPaste(); }
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
    const out: { label: React.ReactNode; to: string }[] = [];
    let acc = base;
    if (base) out.push({ label: p.rootLabel ?? baseName(base), to: base });
    for (const part of parts) {
      acc = acc ? join(acc, part) : part.endsWith(":") ? part + sep : sep + part;
      out.push({ label: part, to: acc });
    }
    return out;
  })();

  const itemProps = (e: Entry, m: string | null | undefined) => {
    const cut = clipboard?.mode === "cut" && clipboard.paths.includes(e.path);
    return {
      className: (sel.has(e.path) ? "selected " : "") + (m === "deleted" ? "deleted " : "") + (cut || e.hidden ? "dim" : ""),
      onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); click(ev, e); },
      onDoubleClick: () => open(e),
      onContextMenu: (ev: React.MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); if (!sel.has(e.path)) setSel(new Set([e.path])); setMenu({ x: ev.clientX, y: ev.clientY, target: e }); },
      ...(m === "deleted" ? {} : dragProps(() => (sel.has(e.path) ? [...sel] : [e.path]), () => (sel.has(e.path) && sel.size > 1 ? t("{0} 個の項目", [sel.size]) : e.name))),
      ...(e.is_dir && m !== "deleted" ? dropProps(e.path) : {}),
    };
  };
  const nameOf = (e: Entry) => renaming === e.path
    ? <RenameInput initial={e.name} onDone={(n) => commitRename(e, n)} />
    : <span>{e.name}</span>;

  const sortBy = (k: "name" | "modified" | "size") => setSort((s) => ({ key: k, asc: s.key === k ? !s.asc : true }));
  const arrow = (k: string) => (sort.key === k ? (sort.asc ? " ▲" : " ▼") : "");

  return (
    <div className="browser" onKeyDown={key}>
      <div className="navbar">
        <button className="icon" title={t("戻る")} disabled={!back.length && !p.canOuterBack} onClick={goBackNav}>←</button>
        <button className="icon" title={t("進む")} disabled={!fwd.length} onClick={() => { const f = fwd[0]; setFwd(fwd.slice(1)); setBack([...back, path]); go(f, false); }}>→</button>
        <button className="icon" title={t("上へ（Backspace）")} onClick={up} disabled={!!p.rootLimit && path === p.rootLimit && !p.outerUp}>↑</button>
        <button className="icon" title={t("最新の情報に更新（F5）")} onClick={() => load()}>↻</button>
        {addr === null ? (
          <div className="address" onClick={() => !p.rootLimit && setAddr(path)}>
            {crumbs.map((c, i) => (
              <span key={i}>{i > 0 && <span className="crumb-sep"> › </span>}
                <span className="crumb" onClick={(ev) => { ev.stopPropagation(); go(c.to); }}>{c.label}</span>
              </span>
            ))}
            {p.rootLimit && (
              <span className="addr-path" title={t("クリックでエクスプローラーで開く")}
                onClick={(ev) => { ev.stopPropagation(); fsApi.reveal(path); }}>📂 {path}</span>
            )}
          </div>
        ) : (
          <input className="address" autoFocus value={addr} onChange={(e) => setAddr(e.target.value)}
            onBlur={() => setAddr(null)}
            onKeyDown={(e) => { if (e.key === "Enter") { go(addr); setAddr(null); } if (e.key === "Escape") setAddr(null); }} />
        )}
        <input className="search" placeholder={t("🔍 {0} の中を絞り込み", [baseName(path) || path])} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <div className="commandbar">
        <div className="dropdown">
          <button onClick={(e) => { e.stopPropagation(); setNewMenu(!newMenu); }}>{t("⊕ 新規作成 ▾")}</button>
          {newMenu && (
            <div className="menu" style={{ top: "100%", left: 0 }}>
              <div onClick={() => createNew("folder")}>{t("📁 フォルダー")}</div>
              <div onClick={() => createNew("text")}>{t("📄 テキスト ドキュメント")}</div>
            </div>
          )}
        </div>
        <span className="sep" />
        <button className="icon" title={t("切り取り（Ctrl+X）")} disabled={!selected.length} onClick={() => doCopy("cut")}>✂</button>
        <button className="icon" title={t("コピー（Ctrl+C）")} disabled={!selected.length} onClick={() => doCopy("copy")}>⧉</button>
        <button className="icon" title={t("貼り付け（Ctrl+V）")} disabled={!clipboard} onClick={() => doPaste()}>📋</button>
        <button className="icon" title={t("名前の変更（F2）")} disabled={selected.length !== 1} onClick={() => setRenaming(selected[0].path)}>✏</button>
        <button className="icon" title={t("削除（Delete）")} disabled={!selected.length} onClick={doDelete}>🗑</button>
        <span className="sep" />
        <label className="check"><input type="checkbox" checked={showHidden}
          onChange={(e) => { setShowHidden(e.target.checked); localStorage.setItem("mao.hidden", e.target.checked ? "1" : "0"); }} /> {t("隠しファイル")}</label>
        {p.extraTools && <><span className="sep" />{p.extraTools}</>}
        <span className="grow" />
        <button className={"icon" + (preview ? " on" : "")} title={t("プレビュー ウィンドウ（Alt+P）")} onClick={togglePreview}>{t("👁 プレビュー")}</button>
        <div className="viewsw" title={t("表示方法")}>
          <button className={"icon" + (view === "details" ? " on" : "")} title={t("詳細")} onClick={() => changeView("details")}>☰</button>
          <button className={"icon" + (view === "medium" ? " on" : "")} title={t("中アイコン")} onClick={() => changeView("medium")}>▦</button>
          <button className={"icon" + (view === "large" ? " on" : "")} title={t("大アイコン")} onClick={() => changeView("large")}>⬜</button>
        </div>
      </div>

      {error && <div className="banner error">{error}<button className="small" onClick={() => setError(null)}>×</button></div>}

      <div className="body-row">
      <div className="files-scroll" ref={listRef} tabIndex={0} {...dropProps(path)}
        onClick={(e) => { if (e.target === e.currentTarget) setSel(new Set()); }}
        onContextMenu={(e) => { e.preventDefault(); if (e.target === e.currentTarget) { setSel(new Set()); setMenu({ x: e.clientX, y: e.clientY, target: null }); } }}>
        {view === "details" ? (
        <ColumnTable rows={shown} rowKey={(e) => e.path} storageKey={p.gitRoot ? "mao.fileCols.git" : "mao.fileCols"}
          rowProps={(e) => itemProps(e, markOf(e))}
          columns={[
            { id: "name", label: <>{t("名前")}{arrow("name")}</>, width: 360, className: "name", onHeader: () => sortBy("name"), title: (e) => e.name,
              cell: (e) => <><span className="ficon">{e.is_dir ? "📁" : icon(e.name)}</span>{nameOf(e)}</> },
            { id: "modified", label: <>{t("更新日時")}{arrow("modified")}</>, width: 170, className: "muted", onHeader: () => sortBy("modified"), cell: (e) => fmtTime(e.modified) },
            { id: "size", label: <>{t("サイズ")}{arrow("size")}</>, width: 100, className: "muted num", onHeader: () => sortBy("size"), cell: (e) => (e.is_dir ? "" : fmtSize(e.size)) },
            ...(p.gitRoot ? [{ id: "state", label: t("状態"), width: 110, cell: (e: Entry) => { const m = markOf(e); return m ? <span className={`mark ${m}`}>● {CHANGE_LABEL[m] ?? m}</span> : <span className="mark ok" title={t("クラウドと同じ内容です")}>✓</span>; } }] : []),
          ]} />
        ) : (
          <div className={`tiles ${view}`}>
            {shown.map((e) => {
              const m = markOf(e);
              return (
                <div key={e.path} {...itemProps(e, m)} className={"tile " + itemProps(e, m).className} title={e.name}>
                  <div className="tile-icon">{e.is_dir ? "📁" : isImage(e) ? <Thumb path={e.path} modified={e.modified} fallback={icon(e.name)} /> : icon(e.name)}
                    {m && <span className={`tile-mark mark ${m}`} title={CHANGE_LABEL[m] ?? m}>●</span>}</div>
                  <div className="tile-name">{nameOf(e)}</div>
                </div>
              );
            })}
          </div>
        )}
        {entries && shown.length === 0 && <p className="muted empty">{filter ? t("一致する項目はありません") : t("このフォルダーは空です")}</p>}
        {!entries && <p className="muted empty">{t("読み込み中…")}</p>}
      </div>

      {preview && <Preview entry={selected.length === 1 ? selected[0] : null} count={selected.length}
        git={selected.length === 1 && p.gitRoot && !selected[0].is_dir && markOf(selected[0]) ? { root: p.gitRoot, rel: rel(selected[0].path)!, kind: markOf(selected[0])! } : null} />}
      </div>

      <div className="statusbar">
        {t("{0} 個の項目", [shown.length])}{selected.length ? t("　{0} 個を選択", [selected.length]) : ""}
        {selected.length === 1 && !selected[0].is_dir ? `　${fmtSize(selected[0].size)}` : ""}
        {p.extraStatus && <>　｜　{p.extraStatus}</>}
      </div>

      {menu && (
        <div className="menu" style={{ top: menu.y, left: menu.x, position: "fixed" }} onClick={(e) => e.stopPropagation()}>
          {menu.target ? (
            <>
              <div onClick={() => { setMenu(null); open(menu.target!); }}><b>{t("開く")}</b></div>
              <hr />
              <div onClick={() => { setMenu(null); doCopy("cut"); }}>{t("✂ 切り取り")}</div>
              <div onClick={() => { setMenu(null); doCopy("copy"); }}>{t("⧉ コピー")}</div>
              {menu.target.is_dir && clipboard && <div onClick={() => { setMenu(null); doPaste(menu.target!.path); }}>{t("📋 このフォルダーに貼り付け")}</div>}
              <div className={selected.length !== 1 ? "disabled" : ""} onClick={() => { setMenu(null); selected.length === 1 && setRenaming(selected[0].path); }}>{t("✏ 名前の変更")}</div>
              <div onClick={() => { setMenu(null); doDelete(); }}>{t("🗑 削除")}</div>
              <hr />
              <div onClick={() => { setMenu(null); navigator.clipboard.writeText(selected.map((e) => e.path).join("\n")); }}>{t("パスのコピー")}</div>
              <div onClick={() => { setMenu(null); fsApi.reveal(menu.target!.path); }}>{t("OSのファイラーで表示")}</div>
            </>
          ) : (
            <>
              <div onClick={() => { setMenu(null); createNew("folder"); }}>{t("📁 新しいフォルダー")}</div>
              <div onClick={() => { setMenu(null); createNew("text"); }}>{t("📄 新しいテキスト ドキュメント")}</div>
              <hr />
              <div className={!clipboard ? "disabled" : ""} onClick={() => { setMenu(null); doPaste(); }}>{t("📋 貼り付け")}</div>
              <div onClick={() => { setMenu(null); load(); }}>{t("↻ 最新の情報に更新")}</div>
              <hr />
              <div onClick={() => { setMenu(null); changeView("large"); }}>{view === "large" ? "✔" : "　"} {t("大アイコン")}</div>
              <div onClick={() => { setMenu(null); changeView("medium"); }}>{view === "medium" ? "✔" : "　"} {t("中アイコン")}</div>
              <div onClick={() => { setMenu(null); changeView("details"); }}>{view === "details" ? "✔" : "　"} {t("詳細")}</div>
              <hr />
              <div onClick={() => { setMenu(null); fsApi.reveal(path); }}>{t("OSのファイラーで表示")}</div>
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

const IMG = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"];
const isImage = (e: Entry) => !e.is_dir && IMG.includes(e.name.split(".").pop()?.toLowerCase() ?? "") && e.size < 50 * 1024 * 1024;

/** 画像のサムネイル（読めなければ通常のアイコン） */
function Thumb({ path, modified, fallback }: { path: string; modified: number | null; fallback: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return <>{fallback}</>;
  return <img className="thumb" loading="lazy" decoding="async" alt="" draggable={false}
    src={`${convertFileSrc(path)}?v=${modified ?? 0}`} onError={() => setBad(true)} />;
}
