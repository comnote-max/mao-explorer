import { useState } from "react";
import { api, Project } from "../api";
import { ACCESS_LABEL, T } from "../terms";

export default function ProjectList({
  projects, error, onOpen, onReload,
}: { projects: Project[] | null; error: string | null; onOpen: (p: Project) => void; onReload: () => void }) {
  const [view, setView] = useState<"icons" | "details">(() => { try { return localStorage.getItem("mao.projView") === "icons" ? "icons" : "details"; } catch { return "details"; } });
  const pick = (v: "icons" | "details") => { setView(v); try { localStorage.setItem("mao.projView", v); } catch {} };
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="navbar">
        <div className="address">🐙 GitHub</div>
        <button className="primary" onClick={() => setCreating(true)}>＋ 新しいプロジェクト</button>
        <div className="viewsw">
          <button className={"icon" + (view === "icons" ? " on" : "")} title="アイコン" onClick={() => pick("icons")}>▦</button>
          <button className={"icon" + (view === "details" ? " on" : "")} title="詳細" onClick={() => pick("details")}>☰</button>
        </div>
        <button onClick={onReload}>↻ 更新</button>
      </div>
      {error && <p className="error pad">{error}</p>}
      {!projects && !error && <p className="muted pad">読み込み中…</p>}
      {projects && view === "icons" && (
        <div className="files-scroll"><div className="tiles large">
          {projects.map((p) => (
            <div key={p.full_name} className={"tile" + (p.synced ? "" : " dim")} onClick={() => onOpen(p)}
              title={`${p.full_name}
${p.private ? T.private : T.public}・${ACCESS_LABEL[p.access]}・${p.synced ? T.synced : T.unsynced}${p.description ? "\n" + p.description : ""}`}>
              <div className="tile-icon">📦<span className="tile-mark">{p.private ? "🔒" : "🌐"}</span></div>
              <div className="tile-name">{p.name}</div>
              {!p.synced && <div className="muted small-text">{T.unsynced}</div>}
            </div>
          ))}
        </div></div>
      )}
      {projects && view === "details" && (
        <div className="files-scroll"><table className="list">
          <thead>
            <tr><th>名前</th><th>公開</th><th>状態</th><th>権限</th><th>更新日時</th></tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.full_name} className={p.synced ? "" : "unsynced"} onDoubleClick={() => onOpen(p)} onClick={() => onOpen(p)}>
                <td>📁 {p.name}<span className="muted small-text">　{p.owner}</span></td>
                <td>
                  <span className={"badge " + (p.private ? "private" : "public")}>{p.private ? `🔒 ${T.private}` : `🌐 ${T.public}`}</span>
                </td>
                <td>{p.synced ? T.synced : T.unsynced}</td>
                <td>{ACCESS_LABEL[p.access]}</td>
                <td className="muted">{new Date(p.updated_at).toLocaleString("ja-JP")}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {creating && <NewProject onClose={() => setCreating(false)} onDone={(p) => { setCreating(false); onReload(); onOpen(p); }} />}
      <div className="statusbar">{projects ? `${projects.length} 個の${T.repository}` : ""}</div>
    </>
  );
}

function NewProject({ onClose, onDone }: { onClose: () => void; onDone: (p: Project) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [priv, setPriv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^[A-Za-z0-9._-]+$/.test(name.trim()) && !/^\.+$/.test(name.trim());
  const ok = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    try { onDone(await api.createProject(name.trim(), priv, desc)); }
    catch (e) { setErr(String(e).includes("422") ? "同じ名前のプロジェクトがすでにあります。別の名前にしてください。" : `作れませんでした：${e}`); setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); ok(); }}>
        <h3>新しいプロジェクトを作る</h3>
        <label>名前（半角の英数字・ - _ . ）
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例：my-project" disabled={busy} />
        </label>
        {name && !valid && <div className="error">名前には半角の英数字と - _ . だけが使えます（日本語やスペースは使えません）。</div>}
        <label>説明（なくても可）
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="例：見積書のテンプレート集" disabled={busy} />
        </label>
        <div className="radio-row">
          <label><input type="radio" checked={priv} onChange={() => setPriv(true)} disabled={busy} /> 🔒 {T.private}（招待した人だけ見られる）</label>
          <label><input type="radio" checked={!priv} onChange={() => setPriv(false)} disabled={busy} /> 🌐 {T.public}（世界中の誰でも見られる）</label>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="row-end">
          <button type="button" onClick={onClose} disabled={busy}>キャンセル</button>
          <button className="primary" disabled={!valid || busy}>{busy ? "作成中…" : "作成"}</button>
        </div>
      </form>
    </div>
  );
}
