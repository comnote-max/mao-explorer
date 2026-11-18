import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, Invite, Member, Project } from "../api";

const ROLE: Record<string, string> = { admin: "管理者", maintain: "管理補佐", write: "編集できる", triage: "整理できる", read: "見るだけ" };
const ORDER = ["admin", "maintain", "write", "triage", "read"];
const CHOICES = ["read", "write", "admin"];

/** 右上の👥：このプロジェクトに接続できる人の一覧と招待（クリックでプルダウン）。 */
export default function Members({ project }: { project: Project }) {
  const [list, setList] = useState<Member[] | null>(null);
  const [pending, setPending] = useState<Invite[]>([]);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("");
  const [role, setRole] = useState("write");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const admin = project.access === "admin";
  const fn = project.full_name;

  const load = () => {
    api.members(fn).then((l) => { setErr(false); setList(l.sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role))); }).catch(() => setErr(true));
    if (admin) api.invites(fn).then(setPending).catch(() => setPending([]));
  };
  useEffect(() => { setList(null); setPending([]); setErr(false); load(); }, [fn]);
  useEffect(() => {
    if (!open) return;
    const c = () => setOpen(false);
    window.addEventListener("click", c);
    return () => window.removeEventListener("click", c);
  }, [open]);

  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setNote(null);
    try { await f(); if (ok) setNote(ok); load(); }
    catch (e) { setNote(`できませんでした：${String(e).includes("404") ? "その GitHub ユーザー名は見つかりません" : e}`); }
    finally { setBusy(false); }
  };
  const send = () => {
    const name = who.trim().replace(/^@/, "");
    if (!name) return;
    run(async () => {
      const sent = await api.invite(fn, name, role);
      setWho("");
      setNote(sent ? `${name} さんに招待を送りました。相手が GitHub で承諾すると参加します。` : `${name} さんの役割を「${ROLE[role]}」に変えました。`);
    });
  };
  const changeRole = (m: Member, r: string) => run(() => api.invite(fn, m.login, r), `${m.login} さんを「${ROLE[r]}」にしました。`);
  const remove = (m: Member) => {
    if (!window.confirm(`${m.login} さんをこのプロジェクトから外します。\n相手は手元のフォルダは残りますが、新しく保存・反映できなくなります。よろしいですか？`)) return;
    run(() => api.removeMember(fn, m.login), `${m.login} さんを外しました。`);
  };

  return (
    <div className="members" onClick={(e) => e.stopPropagation()}>
      <button className="members-btn" title="このプロジェクトに接続できる人" onClick={() => setOpen(!open)}>
        {list && list.length > 0 && (
          <span className="faces">{list.slice(0, 3).map((m) => <img key={m.login} src={m.avatar_url} alt="" />)}</span>
        )}
        👥 {list ? list.length : err ? "?" : "…"}{pending.length > 0 && <span className="muted"> +{pending.length}</span>} ▾
      </button>
      {open && (
        <div className="menu members-menu">
          <div className="members-title">このプロジェクトに接続できる人</div>
          {err && <div className="muted disabled">一覧を見るには編集の権限が必要です</div>}
          {!list && !err && <div className="muted disabled">読み込み中…</div>}
          {list?.map((m) => (
            <div key={m.login} className="member" onClick={() => openUrl(`https://github.com/${m.login}`)}>
              <img src={m.avatar_url} alt="" width={22} height={22} />
              <span className="grow">{m.login}</span>
              {admin && m.login !== project.owner ? (
                <>
                  <select className={"badge role-" + m.role} value={m.role} disabled={busy}
                    onClick={(e) => e.stopPropagation()} onChange={(e) => changeRole(m, e.target.value)}>
                    {(CHOICES.includes(m.role) ? CHOICES : [m.role, ...CHOICES]).map((r) => <option key={r} value={r}>{ROLE[r] ?? r}</option>)}
                  </select>
                  <button className="icon small" title="このプロジェクトから外す" disabled={busy} onClick={(e) => { e.stopPropagation(); remove(m); }}>✕</button>
                </>
              ) : <span className={"badge role-" + m.role}>{m.login === project.owner ? "持ち主" : ROLE[m.role] ?? m.role}</span>}
            </div>
          ))}
          {admin && pending.length > 0 && <>
            <div className="members-title">招待中（相手の承諾待ち）</div>
            {pending.map((i) => (
              <div key={i.id} className="member pending">
                <img src={i.avatar_url} alt="" width={22} height={22} />
                <span className="grow">{i.login}</span>
                <span className="badge">{ROLE[i.role] ?? i.role}</span>
                <button className="icon small" title="招待を取り消す" disabled={busy}
                  onClick={() => run(() => api.cancelInvite(fn, i.id), `${i.login} さんへの招待を取り消しました。`)}>✕</button>
              </div>
            ))}
          </>}
          {admin && <>
            <hr />
            <div className="members-title">人を招待する</div>
            <form className="invite" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input placeholder="GitHub のユーザー名" value={who} onChange={(e) => setWho(e.target.value)} disabled={busy} autoFocus />
              <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
                {CHOICES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
              </select>
              <button className="primary" disabled={busy || !who.trim()}>{busy ? "…" : "招待"}</button>
            </form>
          </>}
          {note && <div className="members-note">{note}</div>}
        </div>
      )}
    </div>
  );
}
