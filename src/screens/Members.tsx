import { useEffect, useRef, useState } from "react";
import { HELP } from "../terms";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, Invite, Member, Project } from "../api";
import { t , tErr } from "../i18n";

const ROLE: Record<string, string> = { admin: t("管理者"), maintain: t("管理補佐"), write: t("編集できる"), triage: t("整理できる"), read: t("見るだけ") };
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
  const inputRef = useRef<HTMLInputElement>(null);
  const admin = project.access === "admin";
  const fn = project.full_name;

  const load = () => {
    api.members(fn).then((l) => { setErr(false); setList(l.sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role))); }).catch(() => setErr(true));
    if (admin) api.invites(fn).then(setPending).catch(() => setPending([]));
  };
  useEffect(() => { setList(null); setPending([]); setErr(false); load(); }, [fn]);
  // ほかの画面（送信後のお知らせなど）から開けるように
  useEffect(() => {
    const o = () => setOpen(true);
    window.addEventListener("mao:open-members", o);
    return () => window.removeEventListener("mao:open-members", o);
  }, []);
  // 人数をほかの画面に知らせる（「まだ自分だけ」の案内用）
  useEffect(() => { if (list) window.dispatchEvent(new CustomEvent("mao:members", { detail: { fn, count: list.length + pending.length } })); }, [list, pending, fn]);
  const alone = !!list && list.length + pending.length <= 1;
  useEffect(() => {
    if (!open) return;
    const c = () => setOpen(false);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("click", c);
    window.addEventListener("keydown", k);
    // 画面がずれないよう、スクロールさせずに入力欄へ
    inputRef.current?.focus({ preventScroll: true });
    return () => { window.removeEventListener("click", c); window.removeEventListener("keydown", k); };
  }, [open]);

  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setNote(null);
    try { await f(); if (ok) setNote(ok); load(); }
    catch (e) { setNote(t("できませんでした：{0}", [tErr(e).includes("404") ? t("その GitHub ユーザー名は見つかりません") : tErr(e)])); }
    finally { setBusy(false); }
  };
  const send = () => {
    const name = who.trim().replace(/^@/, "");
    if (!name) return;
    run(async () => {
      const sent = await api.invite(fn, name, role);
      setWho("");
      setNote(sent ? t("{0} さんに招待を送りました。相手に届く GitHub のメール（または github.com の通知）で「承諾」を押してもらうと、見られるようになります。", [name]) : t("{0} さんの役割を「{1}」に変えました。", [name, ROLE[role]]));
    });
  };
  const changeRole = (m: Member, r: string) => run(() => api.invite(fn, m.login, r), t("{0} さんを「{1}」にしました。", [m.login, ROLE[r]]));
  const remove = (m: Member) => {
    if (!window.confirm(t("{0} さんをこのプロジェクトから外します。\n相手は手元のフォルダは残りますが、新しく履歴保存・反映できなくなります。よろしいですか？", [m.login]))) return;
    run(() => api.removeMember(fn, m.login), t("{0} さんを外しました。", [m.login]));
  };

  return (
    <div className="members" onClick={(e) => e.stopPropagation()}>
      <button className={"members-btn" + (alone && admin ? " alone" : "")} title={HELP.members} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        {list && list.length > 0 && (
          <span className="faces">{list.slice(0, 3).map((m) => <img key={m.login} src={m.avatar_url} alt="" />)}</span>
        )}
        👥 {t("共有")} {list ? (alone ? t("（まだ自分だけ）") : t("{0}人", [list.length])) : err ? "" : "…"}{pending.length > 0 && <span className="muted">{t("・招待中 {0}", [pending.length])}</span>} ▾
      </button>
      {open && (
        <div className="menu members-menu">
          <div className="members-title">{t("このフォルダを見られる人")}</div>
          <div className="muted small-text" style={{ padding: "0 10px 6px" }}>{project.private ? t("🔒 ここに並んでいる人だけが見られます。ほかの人に見せるには、下の「人を招待する」から招待してください。") : t("🌐 全世界に公開中です。誰でも見られます。編集できるのはここに並んでいる人だけです。")}</div>
          {err && <div className="muted disabled">{t("一覧を見るには編集の権限が必要です")}</div>}
          {!list && !err && <div className="muted disabled">{t("読み込み中…")}</div>}
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
                  <button className="icon small" title={t("このプロジェクトから外す")} disabled={busy} onClick={(e) => { e.stopPropagation(); remove(m); }}>✕</button>
                </>
              ) : <span className={"badge role-" + m.role}>{m.login === project.owner ? t("持ち主") : ROLE[m.role] ?? m.role}</span>}
            </div>
          ))}
          {admin && pending.length > 0 && <>
            <div className="members-title">{t("招待中（相手の承諾待ち）")}</div>
            {pending.map((i) => (
              <div key={i.id} className="member pending">
                <img src={i.avatar_url} alt="" width={22} height={22} />
                <span className="grow">{i.login}</span>
                <span className="badge">{ROLE[i.role] ?? i.role}</span>
                <button className="icon small" title={t("招待を取り消す")} disabled={busy}
                  onClick={() => run(() => api.cancelInvite(fn, i.id), t("{0} さんへの招待を取り消しました。", [i.login]))}>✕</button>
              </div>
            ))}
          </>}
          {admin && <>
            <hr />
            <div className="members-title">{t("人を招待する")}</div>
            <div className="muted small-text" style={{ padding: "0 10px 6px" }}>{t("相手の GitHub のユーザー名を入れてください。相手がまだ GitHub に登録していなければ、先に登録してもらい、ユーザー名を教えてもらいます。")}</div>
            <form className="invite" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input placeholder={t("GitHub のユーザー名")} value={who} onChange={(e) => setWho(e.target.value)} disabled={busy} ref={inputRef} />
              <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
                {CHOICES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
              </select>
              <button className="primary" disabled={busy || !who.trim()}>{busy ? "…" : t("招待")}</button>
            </form>
          </>}
          {note && <div className="members-note">{note}</div>}
        </div>
      )}
    </div>
  );
}
