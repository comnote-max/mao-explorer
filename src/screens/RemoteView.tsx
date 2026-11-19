import { useEffect, useState } from "react";
import { api, dispName, fmtSize, Project, RemoteEntry } from "../api";
import { T, HELP } from "../terms";
import { isMarkdown, MarkdownToggle } from "../Markdown";
import { t , tErr } from "../i18n";
import ColumnTable from "./ColumnTable";

const UP = "\u0000up";

/** 未同期プロジェクトの閲覧（読み取り専用）と初回同期。 */
export default function RemoteView({ project, onSynced, canBack, onBack, onUp }: {
  project: Project; onSynced: () => void; canBack?: boolean; onBack?: () => void; onUp?: () => void;
}) {
  const [path, setPathRaw] = useState("");
  const [back, setBack] = useState<string[]>([]);
  const [fwd, setFwd] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const setPath = (p: string) => { if (p === path) return; setBack((b) => [...b, path]); setFwd([]); setPathRaw(p); };
  const goBack = () => { const b = back[back.length - 1]; if (b === undefined) { if (canBack) onBack?.(); return; } setBack(back.slice(0, -1)); setFwd([path, ...fwd]); setText(null); setPathRaw(b); };
  const goFwd = () => { const f = fwd[0]; if (f === undefined) return; setFwd(fwd.slice(1)); setBack([...back, path]); setText(null); setPathRaw(f); };
  const [items, setItems] = useState<RemoteEntry[] | null>(null);
  const [text, setText] = useState<{ name: string; body: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  type View = "details" | "medium" | "large";
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem("mao.view") as View) || "details"; } catch { return "details"; } });
  const [preview, setPreview] = useState(() => { try { return localStorage.getItem("mao.preview") !== "0"; } catch { return true; } });
  const togglePreview = () => setPreview((v) => { try { localStorage.setItem("mao.preview", v ? "0" : "1"); } catch { /* 任意 */ } return !v; });
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.altKey && ev.key.toLowerCase() === "p") { ev.preventDefault(); togglePreview(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  const changeView =(v: View) => { setView(v); try { localStorage.setItem("mao.view", v); } catch { /* 任意 */ } };
  const [dest, setDest] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    setItems(null);
    setError(null);
    api.browseRemote(project.full_name, path, project.default_branch).then(setItems).catch((e) => setError(tErr(e)));
    if (path === "") api.readme(project.full_name).then((r) => r && setText({ name: "README", body: r })).catch(() => {});
  }, [path, project.full_name, tick]);

  useEffect(() => {
    api.defaultRoot(dispName(project)).then(setDest);
  }, [project.name]);

  const open = (e: RemoteEntry) => {
    if (e.is_dir) {
      setText(null);
      setPath(e.path);
    } else {
      setText({ name: e.name, body: undefined as unknown as null });
      api.readRemote(project.full_name, e.path, project.default_branch)
        .then((b) => setText({ name: e.name, body: b }))
        .catch((er) => setError(String(er)));
    }
  };

  const doSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.firstSync(project.full_name, project.default_branch, dest);
      onSynced();
    } catch (e) {
      setError(tErr(e));
    } finally {
      setSyncing(false);
    }
  };

  const crumbs = path ? path.split("/") : [];
  const rows: RemoteEntry[] = [...(path ? [{ name: "..", path: UP, is_dir: true, size: 0 }] : []), ...(items ?? [])];
  const goUp = () => { if (path) { setText(null); setPath(crumbs.slice(0, -1).join("/")); } else onUp?.(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goFwd(); }
      if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); goUp(); }
      if (e.key === "F5") { e.preventDefault(); setTick((t) => t + 1); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return (
    <>
      <div className="toolbar">
        <button className="icon" title={t("戻る（Alt+←）")} disabled={!back.length && !canBack} onClick={goBack}>←</button>
        <button className="icon" title={t("進む（Alt+→）")} disabled={!fwd.length} onClick={goFwd}>→</button>
        <button className="icon" title={path ? t("上へ（Alt+↑）") : t("GitHub の一覧へ（Alt+↑）")} onClick={goUp}>↑</button>
        <button className="icon" title={t("最新の状態に更新（F5）")} onClick={() => setTick(tick + 1)}>↻</button>
        <div className="address">
          <span className="link" onClick={() => setPath("")}>{dispName(project)}</span>
          {crumbs.map((c, i) => (
            <span key={i}> › <span className="link" onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}>{c}</span></span>
          ))}
        </div>
        <div className="viewsw" title={t("表示方法")}>
          <button className={"icon" + (view === "details" ? " on" : "")} title={t("詳細")} onClick={() => changeView("details")}>☰</button>
          <button className={"icon" + (view === "medium" ? " on" : "")} title={t("中アイコン")} onClick={() => changeView("medium")}>▦</button>
          <button className={"icon" + (view === "large" ? " on" : "")} title={t("大アイコン")} onClick={() => changeView("large")}>⬜</button>
        </div>
        <button className={"icon" + (preview ? " on" : "")} title={t("プレビュー ウィンドウ（Alt+P）")} onClick={togglePreview}>{t("👁 プレビュー")}</button>
        <span className="badge unsynced-badge">☁ {T.unsynced}・{t("閲覧のみ")}</span>
        <button className="primary" title={HELP.clone} onClick={() => setAsking(true)} disabled={syncing}>
          ⇅ {t("{0}して編集する", [T.sync])}
        </button>
      </div>
      {asking && (
        <div className="banner">
          <span>{t("保存先：")}</span>
          <input className="grow" value={dest} onChange={(e) => setDest(e.target.value)} />
          <button className="primary" onClick={doSync} disabled={syncing || !dest}>
            {syncing ? `${T.syncing}…` : t("{0}を開始", [T.clone])}
          </button>
          <button onClick={() => setAsking(false)} disabled={syncing}>{t("やめる")}</button>
        </div>
      )}
      {error && <p className="error pad">{error}</p>}
      <div className="split" style={preview && text ? undefined : { gridTemplateColumns: "1fr" }}>
        <div className="files-scroll">
          {view === "details" ? (
            <ColumnTable rows={rows} rowKey={(e) => e.path} storageKey="mao.remoteCols"
              rowProps={(e) => ({ onClick: () => (e.path === UP ? setPath(crumbs.slice(0, -1).join("/")) : open(e)) })}
              columns={[
                { id: "name", label: t("名前"), width: 360, cell: (e) => e.path === UP ? "⬆ .." : `${e.is_dir ? "📁" : "📄"} ${e.name}`, title: (e) => e.name },
                { id: "type", label: t("種類"), width: 130, className: "muted", cell: (e) => e.path === UP ? "" : e.is_dir ? t("フォルダ") : (e.name.includes(".") ? e.name.split(".").pop()!.toUpperCase() + " " + t("ファイル") : t("ファイル")) },
                { id: "size", label: t("サイズ"), width: 110, className: "muted num", cell: (e) => e.is_dir ? "" : fmtSize(e.size) },
              ]} />
          ) : (
            <div className={`tiles ${view}`}>
              {rows.map((e) => (
                <div key={e.path} className="tile" title={e.name}
                  onClick={() => (e.path === UP ? setPath(crumbs.slice(0, -1).join("/")) : open(e))}>
                  <div className="tile-icon">{e.path === UP ? "⬆" : e.is_dir ? "📁" : "📄"}</div>
                  <div className="tile-name">{e.path === UP ? ".." : e.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {preview && text && (
          <div className="preview">
            <div className="preview-title">{text.name}</div>
            {text.body && isMarkdown(text.name)
              ? <MarkdownToggle key={text.name} text={text.body} source={<pre>{text.body}</pre>} />
              : <pre>{text.body === undefined ? t("読み込み中…") : text.body ?? t("（このファイルはここでは表示できません）")}</pre>}
          </div>
        )}
      </div>
      <div className="statusbar">{items ? t("{0} 項目", [items.length]) : t("読み込み中…")}　｜　☁ {t("クラウドの内容を表示しています（PCには取り込んでいません）")}</div>
    </>
  );
}
