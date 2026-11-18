import { useEffect, useState } from "react";
import { api, fmtSize, Project, RemoteEntry } from "../api";
import { T } from "../terms";
import { isMarkdown, MarkdownToggle } from "../Markdown";

/** 未同期プロジェクトの閲覧（読み取り専用）と初回同期。 */
export default function RemoteView({ project, onSynced }: { project: Project; onSynced: () => void }) {
  const [path, setPathRaw] = useState("");
  const [back, setBack] = useState<string[]>([]);
  const [fwd, setFwd] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const setPath = (p: string) => { if (p === path) return; setBack((b) => [...b, path]); setFwd([]); setPathRaw(p); };
  const goBack = () => { if (text) { setText(null); return; } const b = back[back.length - 1]; if (b === undefined) return; setBack(back.slice(0, -1)); setFwd([path, ...fwd]); setText(null); setPathRaw(b); };
  const goFwd = () => { const f = fwd[0]; if (f === undefined) return; setFwd(fwd.slice(1)); setBack([...back, path]); setText(null); setPathRaw(f); };
  const [items, setItems] = useState<RemoteEntry[] | null>(null);
  const [text, setText] = useState<{ name: string; body: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dest, setDest] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    setItems(null);
    setError(null);
    api.browseRemote(project.full_name, path, project.default_branch).then(setItems).catch((e) => setError(String(e)));
    if (path === "") api.readme(project.full_name).then((r) => r && setText({ name: "README", body: r })).catch(() => {});
  }, [path, project.full_name, tick]);

  useEffect(() => {
    api.defaultRoot(project.name).then(setDest);
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
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  };

  const crumbs = path ? path.split("/") : [];
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goFwd(); }
      if (e.altKey && e.key === "ArrowUp" && text) { e.preventDefault(); setText(null); return; }
      if (e.altKey && e.key === "ArrowUp" && path) { e.preventDefault(); setPath(crumbs.slice(0, -1).join("/")); }
      if (e.key === "F5") { e.preventDefault(); setTick((t) => t + 1); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return (
    <>
      <div className="toolbar">
        <button className="icon" title="戻る（Alt+←）" disabled={!back.length && !text} onClick={goBack}>←</button>
        <button className="icon" title="進む（Alt+→）" disabled={!fwd.length} onClick={goFwd}>→</button>
        <button className="icon" title="上へ（Alt+↑）" disabled={!path && !text} onClick={() => { if (text) { setText(null); return; } setPath(crumbs.slice(0, -1).join("/")); }}>↑</button>
        <button className="icon" title="最新の状態に更新（F5）" onClick={() => setTick(tick + 1)}>↻</button>
        <div className="address">
          <span className="link" onClick={() => setPath("")}>{project.name}</span>
          {crumbs.map((c, i) => (
            <span key={i}> › <span className="link" onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}>{c}</span></span>
          ))}
        </div>
        <span className="badge unsynced-badge">☁ {T.unsynced}・閲覧のみ</span>
        <button className="primary" onClick={() => setAsking(true)} disabled={syncing}>
          ⇅ {T.sync}して編集する
        </button>
      </div>
      {asking && (
        <div className="banner">
          <span>保存先：</span>
          <input className="grow" value={dest} onChange={(e) => setDest(e.target.value)} />
          <button className="primary" onClick={doSync} disabled={syncing || !dest}>
            {syncing ? `${T.syncing}…` : `${T.clone}を開始`}
          </button>
          <button onClick={() => setAsking(false)} disabled={syncing}>やめる</button>
        </div>
      )}
      {error && <p className="error pad">{error}</p>}
      <div className="split">
        <table className="list">
          <thead><tr><th>名前</th><th>サイズ</th></tr></thead>
          <tbody>
            {path && (
              <tr onClick={() => setPath(crumbs.slice(0, -1).join("/"))}><td>⬆ ..</td><td /></tr>
            )}
            {items?.map((e) => (
              <tr key={e.path} onClick={() => open(e)}>
                <td>{e.is_dir ? "📁" : "📄"} {e.name}</td>
                <td className="muted">{e.is_dir ? "" : fmtSize(e.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {text && (
          <div className="preview">
            <div className="preview-title">{text.name}</div>
            {text.body && isMarkdown(text.name)
              ? <MarkdownToggle key={text.name} text={text.body} source={<pre>{text.body}</pre>} />
              : <pre>{text.body === undefined ? "読み込み中…" : text.body ?? "（このファイルはここでは表示できません）"}</pre>}
          </div>
        )}
      </div>
      <div className="statusbar">{items ? `${items.length} 項目` : "読み込み中…"}　｜　GitHub上の内容を表示しています</div>
    </>
  );
}
