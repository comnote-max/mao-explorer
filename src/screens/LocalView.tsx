import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, Capability, Change, Folder, MergeView, Project, Request } from "../api";
import { CHANGE_LABEL, HELP, T } from "../terms";
import { copyNumbers, copyText, CopyTag } from "../copyNo";
import FileBrowser from "./FileBrowser";
import RequestsPanel from "./RequestsPanel";
import HistoryDialog from "./HistoryDialog";
import { isUnder } from "./FolderTree";
import { t, LOCALE , tErr } from "../i18n";

type Dialog = null | "save" | "newFolder" | "request" | "requests" | "history";

const seenKey = (fn: string) => `mao.seenRequests.${fn}`;
const loadSeen = (fn: string): number[] => {
  try { return JSON.parse(localStorage.getItem(seenKey(fn)) ?? "[]"); } catch { return []; }
};

/** 同期済みプロジェクト：通常のファイル一覧に、GitHub の操作グループを足したもの。 */
export default function LocalView({ project, cap, path, onPathChange, canBack, onBack, onUp }: {
  project: Project; cap: Capability | null; path?: string; onPathChange?: (p: string) => void;
  canBack?: boolean; onBack?: () => void; onUp?: () => void;
}) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [current, setCurrent] = useState<string>("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "warn"; text: string; invite?: boolean } | null>(null);
  // このフォルダを見られる人数（右上の👥から届く）
  const [people, setPeople] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d.fn === project.full_name) setPeople(d.count); };
    window.addEventListener("mao:members", h);
    return () => window.removeEventListener("mao:members", h);
  }, [project.full_name]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [mergeAfterSave, setMergeAfterSave] = useState(false);
  const [seen, setSeen] = useState<number[]>(() => loadSeen(project.full_name));

  // ツリーで選ばれた場所から、どの（仮想）フォルダかを決める
  useEffect(() => {
    const f = path && folders?.find((x) => isUnder(path, x.path));
    if (f && f.path !== current) setCurrent(f.path);
  }, [path, folders]);
  const folder = folders?.find((f) => f.path === current) ?? folders?.[0];
  const nums = copyNumbers(project.full_name, (folders ?? []).filter((x) => !x.is_main).map((x) => x.name));
  const tagOf = (f: Folder) => f.is_main ? <>🏠 {T.mainBranch}</> : <><CopyTag n={nums[f.name]} /> {f.name}</>;
  const pick = (p: string) => { setCurrent(p); onPathChange?.(p); };

  const loadFolders = useCallback(async () => {
    const fs = await api.folders(project.full_name);
    setFolders(fs);
    setCurrent((c) => (fs.some((f) => f.path === c) ? c : fs[0]?.path ?? ""));
  }, [project.full_name]);

  const loadChanges = useCallback(() => {
    if (folder) api.changes(folder.path).then(setChanges).catch(() => {});
  }, [folder?.path]);

  const loadRequests = useCallback(() => {
    api.requests(project.full_name).then((r) => setRequests(r.list)).catch(() => {});
  }, [project.full_name]);

  useEffect(() => {
    loadFolders().catch((e) => setMessage({ kind: "error", text: tErr(e) }));
    loadRequests();
    const t = window.setInterval(loadRequests, 60_000);
    return () => window.clearInterval(t);
  }, [loadFolders, loadRequests]);

  // 外部アプリでの編集を拾う（ファイル一覧と同じ間隔）
  useEffect(() => {
    loadChanges();
    const t = window.setInterval(() => {
      if (!document.hasFocus()) return;
      loadChanges();
      loadFolders().catch(() => {});
    }, 2500);
    return () => window.clearInterval(t);
  }, [loadChanges, loadFolders]);

  // 同期ボタンは上の見出し（GitHub Desktop で開く の左）に置く
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById("proj-head-slot")); }, []);
  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try { await f(); } catch (e) { setMessage({ kind: "error", text: t("{0}に失敗しました：{1}（ローカルの変更はそのまま残っています）", [label, tErr(e)]) }); }
    finally { setBusy(null); await loadFolders().catch(() => {}); loadChanges(); loadRequests(); }
  };

  // 同期 = 変更があれば自動で履歴保存してから、クラウドと送受信する（ボタン1つで済むように）
  const doSync = () => run(T.sync, async () => {
    if (!folder) return;
    if (changes.length > 0) await api.save(folder.path, autoMessage(changes), []);
    const r = await api.sync(folder.path);
    if (r.result === "need_save") {
      setMessage({ kind: "warn", text: t("履歴未保存の変更が {0} 件あります。先に「{1}」してください。", [r.changes, T.commit]) });
      setDialog("save");
    } else if (r.result === "conflict") {
      setMessage({ kind: "error", text: t("{0}：クラウド側と同じ箇所が変更されています（{1}）。あなたの変更はそのまま残しています。", [T.attention, r.files.join("、")]) });
    } else {
      setMessage(sentMessage(r.sent, r.received));
    }
  });
  const sentMessage = (sent: number, received: number) =>
    sent > 0 && people !== null && people <= 1 && project.private
      ? { kind: "ok" as const, invite: project.access === "admin", text: t("☁ クラウドへ送りました。ただし、このフォルダはまだあなただけのものです。ほかの人に見せるには招待してください。") }
      : { kind: "ok" as const, text: sentText(sent, received) };
  const sentText = (sent: number, received: number) =>
    sent > 0 ? t("☁ クラウドへ送りました。このフォルダに招待されている人も、同じ内容を見られます。")
    : received > 0 ? t("☁ クラウドから {0} 件の更新を受け取りました。", [received])
    : t("✔ クラウドと同じ状態です。");
  // 送ったあとに新しく編集したら「送りました」の表示は消す（送ったと勘違いしないように）
  useEffect(() => { if (changes.length > 0) setMessage((m) => (m?.kind === "ok" ? null : m)); }, [changes.length]);

  const showMerge = (r: MergeView) => {
    if (r.result === "merged") setMessage({ kind: "ok", text: t("{0}です（クラウドの本体で確認しました）", [T.merged]) });
    else if (r.result === "blocked") setMessage({ kind: "warn", text: t("本体へはまだ反映されていません：{0}　依頼は残っています。", [tErr(r.reason)]) });
    else setMessage({ kind: "warn", text: t("クラウドは受け付けましたが、本体での反映をまだ確認できません。少し待ってから同期してください。") });
  };

  // クラウドドライブのように：手元に変更がなく、GitHub側が新しければ自動で取り込む
  const behind = folder?.state.behind ?? 0;
  useEffect(() => {
    if (!folder || busy || behind === 0 || changes.length > 0) return;
    setBusy(T.sync);
    api.sync(folder.path).catch(() => {}).finally(() => { setBusy(null); loadFolders().catch(() => {}); loadChanges(); });
  }, [folder?.path, behind, changes.length]);

  const doMerge =() => run(T.merge, async () => showMerge(await api.mergeFolder(project.full_name, folder!.path, t("{0} を本体に反映", [folder!.name]))));

  const incoming = requests.filter((r) => !r.mine);
  const unseen = incoming.filter((r) => !seen.includes(r.number)).length;
  const openRequests = () => {
    const s = Array.from(new Set([...seen, ...incoming.map((r) => r.number)]));
    setSeen(s);
    localStorage.setItem(seenKey(project.full_name), JSON.stringify(s));
    setDialog("requests");
  };

  const st = folder?.state;
  const nChanges = changes.length;
  const unsent = nChanges > 0 || !!st?.ahead || !!st?.unpublished;
  const cloudState = !st ? { kind: "", text: "", tip: "" }
    : nChanges > 0 ? { kind: "warn", text: t("● まだ送っていない変更 {0} 件", [nChanges]), tip: t("この変更はまだこのPCの中だけです。「⟳ 同期」でクラウドへ送ります。") }
    : st.ahead || st.unpublished ? { kind: "warn", text: t("● まだクラウドへ送っていません"), tip: t("履歴保存はしましたが、クラウドへはまだ送っていません。") }
    : { kind: "ok", text: t("✔ クラウドと同じ"), tip: t("このPCの内容とクラウドの内容は同じです。") };
  const myRequest = folder && requests.find((r) => r.mine && r.head === folder.branch);
  const hasWork = !!folder && !folder.is_main && (st!.not_in_main > 0 || nChanges > 0);
  const statusText = !st ? "" : busy ? t("⟳ {0}中…", [busy])
    : nChanges > 0 ? t("● {0} {1} 件", [T.localChanges, nChanges])
    : st.unpublished ? t("↑ 未送信（クラウドにまだありません）")
    : st.ahead || st.behind ? t("⇅ {0}（送信 {1}・取得 {2}）", [T.pending, st.ahead, st.behind])
    : `✔ ${T.synced}`;
  const mergeText = folder && !folder.is_main && st
    ? st.not_in_main === 0 && nChanges === 0 ? t("✔ {0}（または変更なし）", [T.merged]) : myRequest ? t("✉ 反映依頼中") : t("本体に未反映")
    : null;

  const gitTools = (
    <div className="gitgroup">
      <button onClick={() => setDialog("newFolder")} disabled={!!busy}
        title={!folder || folder.is_main ? HELP.createBranch : HELP.branchFrom}>
        ＋ {!folder || folder.is_main ? T.createBranch : <>{t("{0} から下書き", [copyText(nums[folder.name])])}</>}
      </button>
      {slot && createPortal(<>
        <span className={"cloud-state " + cloudState.kind} title={cloudState.tip}>{cloudState.text}</span>
        <button className={"sync-btn" + (unsent ? " primary" : "")} onClick={doSync} disabled={!!busy}
          title={HELP.sync}>
          <span className={"sync-icon" + (busy === T.sync ? " spin" : "")}>⟳</span> {busy === T.sync ? `${T.syncing}…` : unsent ? t("{0}（クラウドへ送る）", [T.sync]) : T.sync}
        </button>
      </>, slot)}
      <button onClick={() => setDialog("save")} disabled={!!busy || !nChanges} title={HELP.saveWithMemo}>
        📝 {t("メモを付けて送る…")}
      </button>
      <button onClick={() => setDialog("history")} disabled={!!busy || !folder} title={HELP.history}>{t("🕘 履歴")}</button>
      {hasWork && cap?.mode === "request" && (
        <button className="primary" title={HELP.pullRequest} onClick={() => setDialog("request")} disabled={!!busy}>✉ {myRequest ? t("反映依頼中（追記）") : T.pullRequest}</button>
      )}
      {hasWork && cap?.mode === "direct" && (
        <button className="primary" disabled={!!busy} title={HELP.merge + (nChanges > 0 ? "\n" + t("履歴未保存の変更を履歴保存してから反映します") : "")}
          onClick={() => { if (nChanges > 0) { setMergeAfterSave(true); setDialog("save"); } else doMerge(); }}>
          ⤴ {T.merge}
        </button>
      )}
      {incoming.length > 0 ? (
        <button className={unseen > 0 ? "blink" : ""} onClick={openRequests} title={HELP.incoming}>📨 {t("届いた依頼（{0}）", [incoming.length])}</button>
      ) : requests.length > 0 && (
        <button onClick={openRequests} title={HELP.outgoing}>✉ {t("出した依頼（{0}）", [requests.length])}</button>
      )}
    </div>
  );

  if (!folder) return <p className="muted pad">{message?.text ?? t("読み込み中…")}</p>;

  return (
    <>
      {message && <div className={`banner ${message.kind}`}>{message.text}
        {message.invite && <button className="primary small" onClick={() => window.dispatchEvent(new Event("mao:open-members"))}>👥 {t("人を招待する")}</button>}
        <button className="small" onClick={() => setMessage(null)}>×</button></div>}
      <FileBrowser key={folder.path} path={path && isUnder(path, folder.path) ? path : folder.path} onPathChange={onPathChange} rootLimit={folder.path}
        canOuterBack={canBack} outerBack={onBack}
        outerUp={() => { const m = folders?.find((f) => f.is_main); if (!folder.is_main && m) pick(m.path); else onUp?.(); }}
        rootLabel={tagOf(folder)}
        gitRoot={folder.path} gitChanges={changes} extraTools={gitTools}
        extraStatus={<>{statusText}{mergeText && `　｜　${mergeText}`}</>}
        onMutate={loadChanges} />

      {dialog === "history" && folder && (
        <HistoryDialog folder={folder} label={tagOf(folder)} hasChanges={nChanges > 0} onClose={() => setDialog(null)}
          onDone={(text) => { setDialog(null); setMessage({ kind: "warn", text: text + t("　※まだこのPCの中だけです。「⟳ 同期」を押すとクラウドにも反映されます。") }); loadChanges(); }}
          onCopyFrom={async (id, name) => { setDialog(null); await run(T.createBranch, async () => { const f = await api.createFolder(project.full_name, name, folder.path, id); await loadFolders(); pick(f.path); }); }} />
      )}
      {dialog === "save" && (
        <SaveDialog changes={changes} merge={mergeAfterSave} onClose={() => { setDialog(null); setMergeAfterSave(false); }}
          onSave={async (msg, files, send) => {
            setDialog(null);
            const thenMerge = mergeAfterSave;
            setMergeAfterSave(false);
            if (thenMerge) {
              await run(T.merge, async () => {
                await api.save(folder.path, msg, files);
                showMerge(await api.mergeFolder(project.full_name, folder.path, t("{0} を本体に反映", [folder.name])));
              });
            } else if (send) {
              await run(t("保存して送信"), async () => {
                await api.save(folder.path, msg, files);
                const r = await api.sync(folder.path);
                if (r.result === "conflict") setMessage({ kind: "error", text: t("{0}しましたが、ほかの人が同じ箇所を変更しています（{1}）。あなたの変更はそのまま残しています。", [T.commit, r.files.join("、")]) });
                else if (r.result === "need_save") setMessage({ kind: "warn", text: t("{0}しました。選ばなかった変更が {1} 件残っているため、まだ送っていません。", [T.commit, r.changes]) });
                else setMessage(sentMessage(r.sent || 1, r.received));
              });
            } else {
              await run(T.commit, async () => { await api.save(folder.path, msg, files); setMessage({ kind: "ok", text: t("{0}しました（まだこのPCの中だけです）。送るには「{1}」を押してください。", [T.commit, T.sync]) }); });
            }
          }} />
      )}
      {dialog === "newFolder" && (
        <PromptDialog title={folder.is_main ? T.createBranch : t("{0} から下書きを作る", [copyText(nums[folder.name])])} label={t("名前（例：見積書の修正）")} ok={t("作成")}
          note={folder.is_main
            ? t("{0}の最新の内容から、作業用の下書きを作ります。{1}には影響しません。", [T.mainBranch, T.mainBranch])
            : t("{0} の履歴保存済みの内容から、新しい下書きを作ります。{1}元のフォルダと{2}には影響しません。", [copyText(nums[folder.name]), nChanges > 0 ? t("履歴未保存の変更 {0} 件は含まれません。必要なら先に履歴保存してください。", [nChanges]) : "", T.mainBranch])}
          onClose={() => setDialog(null)}
          onOk={(name) => { setDialog(null); return run(T.createBranch, async () => { const f = await api.createFolder(project.full_name, name, folder.is_main ? undefined : folder.path); await loadFolders(); pick(f.path); }); }} />
      )}
      {dialog === "request" && (
        <PromptDialog title={T.pullRequest} label={t("責任者へのメッセージ")} ok={t("依頼を送信")} multiline
          note={nChanges > 0 ? t("履歴未保存の変更が {0} 件あります。先に履歴保存してください。", [nChanges]) : t("「{0}」の内容を、{1}へ反映するよう依頼します。未送信の履歴保存は自動で送信します。", [folder.name, T.mainBranch])}
          disabled={nChanges > 0}
          onClose={() => setDialog(null)}
          onOk={(msg) => { setDialog(null); return run(T.pullRequest, async () => { await api.sendRequest(project.full_name, folder.path, t("{0} を本体へ反映", [folder.name]), msg); setMessage({ kind: "ok", text: t("反映依頼を送信しました。責任者の画面に通知されます。") }); }); }} />
      )}
      {dialog === "requests" && (
        <RequestsPanel project={project} requests={requests} canMerge={!!cap?.can_review || cap?.mode === "direct"}
          onClose={() => setDialog(null)} onDone={(r) => { if (r) showMerge(r); loadRequests(); loadFolders().catch(() => {}); }} />
      )}
    </>
  );
}

function SaveDialog({ changes, merge, onClose, onSave }: { changes: Change[]; merge?: boolean; onClose: () => void; onSave: (msg: string, files: string[], send: boolean) => void }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(changes.map((x) => x.path)));
  const [msg, setMsg] = useState("");
  const all = checked.size === changes.length;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{merge ? t("{0}して{1}", [T.commit, T.merge]) : t("保存して送る")}</h3>
        {!merge && <p className="muted">{t("今の状態を履歴に記録して、クラウドへ送ります。あとから「🕘 履歴」でこの時点に戻せます。")}</p>}
        {merge && <p className="muted">{t("履歴保存すると、そのまま{0}に反映します。", [T.mainBranch])}</p>}
        <div className="changes">
          {changes.map((c) => (
            <label key={c.path}>
              <input type="checkbox" checked={checked.has(c.path)}
                onChange={(e) => { const s = new Set(checked); e.target.checked ? s.add(c.path) : s.delete(c.path); setChecked(s); }} />
              <span className={`mark ${c.kind}`}>{CHANGE_LABEL[c.kind] ?? c.kind}</span> {c.path}
            </label>
          ))}
          {changes.length === 0 && <p className="muted">{t("変更はありません")}</p>}
        </div>
        <label className="field">{t("メッセージ（任意・空なら日時を記録）")}<input autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("例：見積金額を修正")} /></label>
        <div className="actions">
          <button onClick={onClose}>{t("キャンセル")}</button>
          {!merge && <button disabled={checked.size === 0} title={HELP.commitOnly} onClick={() => onSave(msg.trim() || t("{0} の{1}", [new Date().toLocaleString(LOCALE), T.commit]), all ? [] : [...checked], false)}>{t("送らずにこのPCだけに{0}", [T.commit])}</button>}
          <button className="primary" disabled={checked.size === 0} onClick={() => onSave(msg.trim() || t("{0} の{1}", [new Date().toLocaleString(LOCALE), T.commit]), all ? [] : [...checked], !merge)}>{merge ? t("{0}して{1}", [T.commit, T.merge]) : t("☁ 保存して送る")}</button>
        </div>
      </div>
    </div>
  );
}

export function PromptDialog({ title, label, ok, note, multiline, disabled, onClose, onOk }: {
  title: string; label: string; ok: string; note?: string; multiline?: boolean; disabled?: boolean;
  onClose: () => void; onOk: (v: string) => void;
}) {
  const [v, setV] = useState("");
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {note && <p className="muted">{note}</p>}
        <label className="field">{label}
          {multiline ? <textarea autoFocus rows={5} value={v} onChange={(e) => setV(e.target.value)} />
            : <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && v.trim() && onOk(v)} />}
        </label>
        <div className="actions">
          <button onClick={onClose}>{t("キャンセル")}</button>
          <button className="primary" disabled={disabled || !v.trim()} onClick={() => onOk(v)}>{ok}</button>
        </div>
      </div>
    </div>
  );
}

/** 自動で付ける履歴のメモ（例：「見積書_A社.txt を更新」「a.txt・b.txt ほか 3 件を更新」） */
function autoMessage(changes: Change[]) {
  const names = changes.map((c) => c.path.split("/").pop()!);
  const head = names.slice(0, 2).join("・");
  return names.length > 2 ? t("{0} ほか {1} 件を更新", [head, names.length - 2]) : t("{0} を更新", [head]);
}
