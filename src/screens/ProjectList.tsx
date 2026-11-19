import { useEffect, useState } from "react";
import { api, dispDesc, dispName, Project } from "../api";
import { ACCESS_LABEL, T } from "../terms";
import ColumnTable from "./ColumnTable";
import { t, LOCALE , tErr } from "../i18n";

export default function ProjectList({
  projects, error, onOpen, onReload,
}: { projects: Project[] | null; error: string | null; onOpen: (p: Project) => void; onReload: () => void }) {
  const [view, setView] = useState<"icons" | "details">(() => { try { return localStorage.getItem("mao.projView") === "icons" ? "icons" : "details"; } catch { return "details"; } });
  const pick = (v: "icons" | "details") => { setView(v); try { localStorage.setItem("mao.projView", v); } catch {} };
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; p: Project } | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  useEffect(() => { if (!menu) return; const c = () => setMenu(null); window.addEventListener("click", c); return () => window.removeEventListener("click", c); }, [menu]);
  const ctx = (p: Project) => (e: React.MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, p }); };
  const sync = async (p: Project) => {
    setMenu(null);
    const dest = await api.defaultRoot(dispName(p));
    if (!window.confirm(t("「{0}」をPCに取り込みます。\n\n保存先：{1}\n\nファイルが多いと時間がかかります。よろしいですか？", [dispName(p), dest]))) return;
    setSyncing((m) => ({ ...m, [p.full_name]: true }));
    try { await api.firstSync(p.full_name, p.default_branch, dest); onReload(); }
    catch (e) { window.alert(t("同期できませんでした：{0}", [tErr(e)])); }
    finally { setSyncing((m) => ({ ...m, [p.full_name]: false })); }
  };
  return (
    <>
      <div className="navbar">
        <div className="address">🐙 {T.cloud}</div>
        <button className="primary" onClick={() => setCreating(true)}>{t("＋ 新しいフォルダ")}</button>
        <div className="viewsw">
          <button className={"icon" + (view === "icons" ? " on" : "")} title={t("アイコン")} onClick={() => pick("icons")}>▦</button>
          <button className={"icon" + (view === "details" ? " on" : "")} title={t("詳細")} onClick={() => pick("details")}>☰</button>
        </div>
        <button onClick={onReload}>{t("↻ 更新")}</button>
      </div>
      {error && <p className="error pad">{error}</p>}
      {!projects && !error && <p className="muted pad">{t("読み込み中…")}</p>}
      {projects && view === "icons" && (
        <div className="files-scroll"><div className="tiles large">
          {projects.map((p) => (
            <div key={p.full_name} className={"tile" + (p.synced ? "" : " dim")} onClick={() => onOpen(p)} onContextMenu={ctx(p)}
              title={t("{0}\n{1}・{2}・{3}{4}", [dispName(p), p.private ? T.private : T.public, ACCESS_LABEL[p.access], p.synced ? T.synced : T.unsynced, dispDesc(p) ? "\n" + dispDesc(p) : ""])}>
              <div className="tile-icon">{p.synced ? "📁" : "☁"}<span className="tile-mark">{p.private ? "🔒" : "🌐"}</span></div>
              <div className="tile-name">{dispName(p)}</div>
              {!p.synced && <div className="muted small-text">{T.unsynced}</div>}
            </div>
          ))}
        </div></div>
      )}
      {projects && view === "details" && (
        <div className="files-scroll"><ColumnTable rows={projects} rowKey={(p) => p.full_name} storageKey="mao.projCols"
          rowProps={(p) => ({ className: p.synced ? "" : "unsynced", onClick: () => onOpen(p), onContextMenu: ctx(p) })}
          columns={[
            { id: "name", label: t("名前"), width: 320, cell: (p) => <>{p.synced ? "📁" : "☁"} {dispName(p)}<span className="muted small-text">　{dispDesc(p)}</span></>, title: (p) => [dispName(p), dispDesc(p)].filter(Boolean).join("\n") },
            { id: "share", label: t("共有"), width: 110, cell: (p) => <span className={"badge " + (p.private ? "private" : "public")}>{p.private ? `🔒 ${T.private}` : `🌐 ${T.public}`}</span> },
            { id: "state", label: t("状態"), width: 140, cell: (p) => syncing[p.full_name] ? `⏳ ${T.syncing}…` : p.synced ? `✓ ${T.synced}` : `☁ ${T.unsynced}` },
            { id: "access", label: t("権限"), width: 100, cell: (p) => ACCESS_LABEL[p.access] },
            { id: "updated", label: t("更新日時"), width: 170, className: "muted", cell: (p) => new Date(p.updated_at).toLocaleString(LOCALE) },
          ]} /></div>
      )}
      {menu && (
        <div className="menu" style={{ position: "fixed", left: menu.x, top: menu.y }}>
          <div onClick={() => { setMenu(null); onOpen(menu.p); }}>{t("開く")}</div>
          <hr />
          <div className={menu.p.synced || syncing[menu.p.full_name] ? "disabled" : ""} onClick={() => sync(menu.p)}>
            ⇅ {menu.p.synced ? t("{0}です", [T.synced]) : t("PCに取り込む（オフラインでも使えるように）")}
          </div>
        </div>
      )}
      {creating && <NewProject onClose={() => setCreating(false)} onDone={(p) => { setCreating(false); onReload(); onOpen(p); }} />}
      <div className="statusbar">{projects ? t("{0} 個の{1}", [projects.length, T.repository]) : ""}</div>
    </>
  );
}

function NewProject({ onClose, onDone }: { onClose: () => void; onDone: (p: Project) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [priv, setPriv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = name.trim();
  const ascii = /^[A-Za-z0-9._-]+$/.test(n) && !/^\.+$/.test(n);
  const valid = n.length > 0 && !/[\\/:*?"<>|]/.test(n);
  // GitHub 上の名前は英数字だけ。日本語名なら自動の名前にして、表示名は説明の先頭に入れる
  const repoName = ascii ? n : (n.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "folder") + "-" + Date.now().toString(36);
  const ok = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    try { onDone(await api.createProject(repoName, priv, ascii ? desc : `【${n}】${desc}`)); }
    catch (e) { setErr(tErr(e).includes("422") ? t("同じ名前のフォルダがすでにあります。別の名前にしてください。") : t("作れませんでした：{0}", [tErr(e)])); setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); ok(); }}>
        <h3>{t("新しい共有フォルダを作る")}</h3>
        <label>{t("名前")}
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("例：見積書")} disabled={busy} />
        </label>
        {name && !valid && <div className="error">{t("名前に {0} は使えません。", [String.raw`\ / : * ? " < > |`])}</div>}
        <label>{t("説明（なくても可）")}
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("例：見積書のテンプレート集")} disabled={busy} />
        </label>
        <div className="radio-row">
          <label><input type="radio" checked={priv} onChange={() => setPriv(true)} disabled={busy} /> 🔒 {T.private}{t("（社内やチームの人を、あとから招待して共有します）")}</label>
          <label><input type="radio" checked={!priv} onChange={() => setPriv(false)} disabled={busy} /> 🌐 {T.public}{t("（インターネット上の誰でも見られます。社内資料には使わないでください）")}</label>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="row-end">
          <button type="button" onClick={onClose} disabled={busy}>{t("キャンセル")}</button>
          <button className="primary" disabled={!valid || busy}>{busy ? t("作成中…") : t("作成")}</button>
        </div>
      </form>
    </div>
  );
}
