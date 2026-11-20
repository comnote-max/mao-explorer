import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, Capability, Change, Folder, MergeView, Project, Request } from "../api";
import { CHANGE_LABEL, HELP, T } from "../terms";
import { copyNumbers, copyText, CopyTag } from "../copyNo";
import FileBrowser from "./FileBrowser";
import RequestsPanel from "./RequestsPanel";
import HistoryDialog from "./HistoryDialog";
import { isUnder } from "./FolderTree";
import { t, LOCALE, tErr, classic } from "../i18n";

type Dialog = null | "save" | "newFolder" | "request" | "requests" | "history" | "merge";

const seenKey = (fn: string) => `mao.seenRequests.${fn}`;
const loadSeen = (fn: string): number[] => {
  try { return JSON.parse(localStorage.getItem(seenKey(fn)) ?? "[]"); } catch { return []; }
};

/** 同期済みプロジェクト：通常のファイル一覧に、GitHub の操作グループを足したもの。 */
export default function LocalView({ project, cap, path, onPathChange, canBack, onBack, onUp, onNotSynced }: {
  project: Project; cap: Capability | null; path?: string; onPathChange?: (p: string) => void;
  canBack?: boolean; onBack?: () => void; onUp?: () => void; onNotSynced?: () => void;
}) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [current, setCurrent] = useState<string>("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "warn"; text: string; invite?: boolean; cleanup?: Folder } | null>(null);
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
  const [requestAfterSave, setRequestAfterSave] = useState(false);
  const selected = useRef<string[]>([]);
  // 戻したあとなど、ファイル一覧を読み直したいときに増やす
  const [rev, setRev] = useState(0);
  const [seen, setSeen] =useState<number[]>(() => loadSeen(project.full_name));

  // ツリーで選ばれた場所から、どの（仮想）フォルダかを決める
  useEffect(() => {
    // 場所の指定がない（プロジェクト名や本体をクリックした）ときは本体を出す
    const f = path ? folders?.find((x) => isUnder(path, x.path)) : folders?.find((x) => x.is_main);
    if (f && f.path !== current) setCurrent(f.path);
  }, [path, folders]);
  const folder = folders?.find((f) => f.path === current) ?? folders?.[0];
  const nums = copyNumbers(project.full_name, (folders ?? []).filter((x) => !x.is_main).map((x) => x.name));
  const tagOf = (f: Folder) => f.is_main ? <>🏠 {T.mainBranch}</> : <><CopyTag n={nums[f.name]} /> {classic ? f.branch : f.name}</>;
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
    // 取り込み状態が古かった（PCにまだ無い）ときは、取り込み画面に切り替えてもらう
    loadFolders().catch((e) => { if (onNotSynced && String(e).includes("まだ同期されていません")) onNotSynced(); else setMessage({ kind: "error", text: tErr(e) }); });
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
  // 本体に直接送れないチーム（反映依頼が必要）で本体を編集したら、変更を自動で下書きへ移す
  const protectedMain = !classic && !!folder?.is_main && cap?.mode === "request";
  const moveToDraft = () => run(T.sync, async () => {
    if (!folder) return;
    const d = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
    const name = t("変更 {0}", [`${d.getMonth() + 1}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}`]);
    const f = await api.moveToDraft(project.full_name, name);
    await api.sync(f.path).catch(() => {});
    await loadFolders(); pick(f.path);
    setMessage({ kind: "ok", text: t("{0}は直接変更できないため、あなたの変更を下書き「{1}」に移しました。あとは反映依頼を送るだけです。", [T.mainBranch, f.name]) });
    setDialog("request");
  });
  const doSync = () => { setPaused(false); return doSync0(); };
  const doSync0 = () => protectedMain && (changes.length > 0 || !!folder?.state.ahead) ? moveToDraft() : run(T.sync, async () => {
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
  // クラシック：Pull / Push を別々に行う（自動 commit はしない）
  const doPull = () => run("Pull", async () => {
    if (!folder) return;
    const r = await api.pull(folder.path);
    if (r.result === "need_save") setMessage({ kind: "warn", text: t("未 commit の変更が {0} 件あります。先に commit してから Pull してください。", [r.changes], true) });
    else if (r.result === "conflict") setMessage({ kind: "error", text: t("Pull で conflict が起きたため中止しました（{0}）。ローカルはそのままです。", [r.files.join("、")], true) });
    else setMessage({ kind: "ok", text: r.received > 0 ? t("origin から {0} 件の commit を Pull しました。", [r.received], true) : t("すでに最新です（Pull する commit はありません）。", undefined, true) });
  });
  const doPush = () => run("Push", async () => {
    if (!folder) return;
    const r = await api.push(folder.path);
    if (r.result === "done") setMessage(r.sent > 0 ? { kind: "ok", text: t("origin/{0} に {1} 件の commit を Push しました。", [folder.branch, r.sent], true) } : { kind: "ok", text: t("Push する commit はありません。", undefined, true) });
  });
  const sentMessage = (sent: number, received: number) =>
    sent > 0 && people !== null && people <= 1 && project.private
      ? { kind: "ok" as const, invite: project.access === "admin", text: t("☁ クラウドへ送りました。ただし、このフォルダはまだあなただけのものです。ほかの人に見せるには招待してください。") }
      : { kind: "ok" as const, text: sentText(sent, received) };
  const sentText = (sent: number, received: number) =>
    sent > 0 ? t("☁ クラウドへ送りました。このフォルダに招待されている人も、同じ内容を見られます。")
    : received > 0 ? t("☁ クラウドから {0} 件の更新を受け取りました。", [received])
    : t("✔ クラウドと同じ状態です。");
  // モダン：編集が落ち着いたら（20秒変更がなければ）自動で同期する。ボタンを押さなくてもクラウドへ送られる
  const changeSig = changes.map((c) => c.path + c.kind).join("|");
  const [paused, setPaused] = useState(false); // 「今は送らない」：次に自分で同期するまで自動では送らない
  const [dueAt, setDueAt] = useState<number | null>(null);
  const [, setNow] = useState(0);
  const autoOn = !classic && !!folder && !protectedMain && changes.length > 0 && !busy && !dialog && message?.kind !== "error" && !paused;
  useEffect(() => {
    if (!autoOn) { setDueAt(null); return; }
    setDueAt(Date.now() + 20_000);
    const h = window.setTimeout(() => doSync(), 20_000);
    const tk = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(h); window.clearInterval(tk); };
  }, [changeSig, folder?.path, autoOn]);
  const secLeft = dueAt ? Math.max(0, Math.ceil((dueAt - Date.now()) / 1000)) : null;
  // 送ったあとに新しく編集したら「送りました」の表示は消す（送ったと勘違いしないように）
  useEffect(() => { if (changes.length > 0) setMessage((m) => (m?.kind === "ok" ? null : m)); }, [changes.length]);

  const showMerge = (r: MergeView) => {
    if (r.result === "merged") setMessage({ kind: "ok", text: t("{0}です（クラウドの本体で確認しました）", [T.merged]), cleanup: folder && !folder.is_main ? folder : undefined });
    else if (r.result === "blocked") setMessage({ kind: "warn", text: t("本体へはまだ反映されていません：{0}　依頼は残っています。", [tErr(r.reason)]) });
    else setMessage({ kind: "warn", text: t("クラウドは受け付けましたが、本体での反映をまだ確認できません。少し待ってから同期してください。") });
  };

  // クラウドドライブのように：手元に変更がなく、GitHub側が新しければ自動で取り込む
  const behind = folder?.state.behind ?? 0;
  useEffect(() => {
    if (classic || !folder || busy || behind === 0 || changes.length > 0) return;
    setBusy(T.sync);
    api.pull(folder.path).catch(() => {}).finally(() => { setBusy(null); loadFolders().catch(() => {}); loadChanges(); });
  }, [folder?.path, behind, changes.length]);

  const removeBranch = (f: Folder) => {
    if (!window.confirm(classic ? t("branch「{0}」をローカル（worktree）と origin から削除します。よろしいですか？", [f.branch], true)
      : t("下書き「{0}」を片付けます。中身は本体に反映済みです。よろしいですか？", [f.name]))) return;
    return run(classic ? "Delete branch" : t("片付け"), async () => {
      const m = folders?.find((x) => x.is_main);
      await api.removeFolder(project.full_name, f.path, true);
      if (m) pick(m.path);
      setMessage({ kind: "ok", text: classic ? t("branch「{0}」を削除しました。", [f.branch], true) : t("下書き「{0}」を片付けました。", [f.name]) });
    });
  };
  const mergeTitle = (f: Folder) => classic ? `Merge branch '${f.branch}'` : t("{0} を本体に反映", [f.name]);
  const doMerge =() => run(T.merge, async () => showMerge(await api.mergeFolder(project.full_name, folder!.path, mergeTitle(folder!))));

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
    : nChanges > 0 && protectedMain ? { kind: "warn", text: t("● 変更 {0} 件（反映依頼が必要）", [nChanges]), tip: t("このチームの本体は直接変更できません。「⟳ 同期」を押すと、変更を下書きに移して反映依頼の画面を開きます。") }
    : nChanges > 0 && !classic && paused ? { kind: "warn", text: t("● 変更 {0} 件（自動送信を止めています）", [nChanges]), tip: t("「⟳ 同期」を押すと送ります。押すと自動送信も再開します。") }
    : nChanges > 0 && !classic ? { kind: "warn", text: secLeft !== null ? t("● 変更 {0} 件（{1} 秒後に自動で送ります）", [nChanges, secLeft]) : t("● 変更 {0} 件（まもなく自動で送ります）", [nChanges]), tip: t("編集が落ち着くと自動でクラウドへ送ります。すぐ送りたいときは「⟳ 同期」を押してください。") }
    : nChanges > 0 ? { kind: "warn", text: t("● まだ送っていない変更 {0} 件", [nChanges]), tip: t("この変更はまだこのPCの中だけです。「⟳ 同期」でクラウドへ送ります。") }
    : st.unpublished && !st.ahead && st.not_in_main === 0 ? { kind: "ok", text: t("● 変更なし"), tip: t("まだ何も変更していないので、送るものはありません。") }
    : st.ahead || st.unpublished ? { kind: "warn", text: t("● まだクラウドへ送っていません"), tip: t("このPCには記録しましたが、クラウドへはまだ送っていません。「⟳ 同期」で送ります。") }
    : { kind: "ok", text: t("✔ クラウドと同じ"), tip: t("このPCの内容とクラウドの内容は同じです。") };
  const abText = st && !st.unpublished ? `↑${st.ahead} ↓${st.behind}` : t("upstream なし", undefined, true);
  // 反映依頼中の下書き（本体の画面で「確認待ち」として見せる。本体にはまだ入っていないので、ファイルが消えたように見えないように）
  const waiting = (folders ?? []).filter((f) => !f.is_main && requests.some((r) => r.mine && r.head === f.branch));
  const myRequest = folder && requests.find((r) => r.mine && r.head === folder.branch);
  const hasWork = !!folder && !folder.is_main && (st!.not_in_main > 0 || nChanges > 0);
  const statusText = !st ? "" : busy ? t("⟳ {0}中…", [busy])
    : nChanges > 0 ? (classic ? t("● {0} {1} 件", [T.localChanges, nChanges]) : t("● まだ送っていない変更 {0} 件", [nChanges]))
    : st.unpublished && !st.ahead && st.not_in_main === 0 ? t("● 変更なし")
    : st.unpublished ? t("↑ 未送信（クラウドにまだありません）")
    : st.ahead || st.behind ? t("⇅ {0}（送信 {1}・取得 {2}）", [T.pending, st.ahead, st.behind])
    : `✔ ${T.synced}`;
  const mergeText = folder && !folder.is_main && st
    ? st.not_in_main === 0 && nChanges === 0 ? (classic ? (st.unpublished && !st.ahead ? t("✔ main と同じ（この branch に commit なし）", undefined, true) : t("✔ {0}", [T.merged])) : t("✔ 本体と同じ内容")) : myRequest ? t("✉ 反映依頼中") : t("本体に未反映")
    : null;

  const gitTools = (
    <div className="gitgroup">
      {(classic || folder?.is_main) && <button onClick={() => setDialog("newFolder")} disabled={!!busy}
        title={!folder || folder.is_main ? HELP.createBranch : HELP.branchFrom}>
        ＋ {!folder || folder.is_main ? T.createBranch : <>{t("{0} から下書き", [copyText(nums[folder.name], folder.branch)])}</>}
      </button>}
      {slot && createPortal(<>
        <span className={"cloud-state " + cloudState.kind} title={cloudState.tip}>{cloudState.text}</span>
        {!classic && secLeft !== null && <button className="small" onClick={() => setPaused(true)} title={t("編集が終わるまで送りたくないときに。「⟳ 同期」を押すまで自動では送りません")}>{t("今は送らない")}</button>}
        {classic ? <>
          <span className="cloud-state" title={t("origin/{0} との差（↑ Push していない commit・↓ Pull していない commit）", [folder?.branch ?? ""], true)}>{abText}</span>
          <button className="sync-btn" onClick={doPull} disabled={!!busy} title={HELP.pull}>
            <span className={"sync-icon" + (busy === "Pull" ? " spin" : "")}>↓</span> Pull{st?.behind ? ` (${st.behind})` : ""}
          </button>
          <button className={"sync-btn" + (st?.ahead || st?.unpublished ? " primary" : "")} onClick={doPush} disabled={!!busy || (!st?.ahead && !st?.unpublished)} title={HELP.push}>
            <span className={"sync-icon" + (busy === "Push" ? " spin" : "")}>↑</span> Push{st?.ahead ? ` (${st.ahead})` : ""}
          </button>
        </> : (
        <button className={"sync-btn" + (unsent ? " primary" : "")} onClick={doSync} disabled={!!busy}
          title={HELP.sync}>
          <span className={"sync-icon" + (busy === T.sync ? " spin" : "")}>⟳</span> {busy === T.sync ? `${T.syncing}…` : unsent ? t("{0}（クラウドへ送る）", [T.sync]) : T.sync}
        </button>)}
      </>, slot)}
      {classic && <button className={nChanges ? "primary" : ""} onClick={() => setDialog("save")} disabled={!!busy || !nChanges} title={HELP.commit}>📝 Commit…</button>}
      <button onClick={() => setDialog("history")} disabled={!!busy || !folder} title={HELP.history}>{classic ? t("🕘 履歴") : t("🕘 以前の版に戻す")}</button>
      {hasWork && cap?.mode === "request" && (
        <button className="primary" title={HELP.pullRequest} onClick={() => setDialog("request")} disabled={!!busy}>✉ {myRequest ? t("反映依頼中（追記）") : T.pullRequest}</button>
      )}
      {hasWork && cap?.mode === "direct" && (
        <button className="primary" disabled={!!busy} title={HELP.merge + (nChanges > 0 ? "\n" + t("履歴未保存の変更を履歴保存してから反映します") : "")}
          onClick={() => { if (nChanges > 0 && classic) { setMergeAfterSave(true); setDialog("save"); } else setDialog("merge"); }}>
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
      {message && <div className={`banner toast ${message.kind}`}>{message.text}
        {message.cleanup && <button className="small" onClick={() => removeBranch(message.cleanup!)}>🗑 {classic ? t("branch「{0}」を削除", [message.cleanup.branch], true) : t("下書き「{0}」を片付ける", [message.cleanup.name])}</button>}
        {message.invite && <button className="primary small" onClick={() => window.dispatchEvent(new Event("mao:open-members"))}>👥 {t("人を招待する")}</button>}
        <button className="small" onClick={() => setMessage(null)}>×</button></div>}
      {folder.is_main && !classic && waiting.length > 0 && <div className="banner info">
        ⏳ {t("確認待ちの変更があります（まだ{0}には入っていません）：", [T.mainBranch])}
        {waiting.map((f) => <button key={f.path} className="small" onClick={() => pick(f.path)}>{t("下書き「{0}」を開く", [f.name])}</button>)}
      </div>}
      <FileBrowser key={folder.path + "#" + rev}onSelect={(ps) => { selected.current = ps; }} path={path && isUnder(path, folder.path) ? path : folder.path} onPathChange={onPathChange} rootLimit={folder.path}
        canOuterBack={canBack} outerBack={onBack}
        outerUp={() => { const m = folders?.find((f) => f.is_main); if (!folder.is_main && m) pick(m.path); else onUp?.(); }}
        rootLabel={tagOf(folder)}
        gitRoot={folder.path} gitChanges={changes} extraTools={gitTools}
        extraStatus={<>{statusText}{mergeText && `　｜　${mergeText}`}</>}
        onMutate={loadChanges} />

      {dialog === "history" && folder && (
        <HistoryDialog folder={folder} prefer={selected.current[0] && isUnder(selected.current[0], folder.path) ? selected.current[0].slice(folder.path.length + 1).replace(/\\/g, "/") : undefined} label={tagOf(folder)} hasChanges={nChanges > 0} onClose={() => setDialog(null)}
          onDone={(text) => { setDialog(null); setMessage({ kind: "warn", text: text + (classic ? t("　※まだこのPCの中だけです。「⟳ 同期」を押すとクラウドにも反映されます。") : t("　しばらくすると自動でクラウドへ送ります。")) }); loadChanges(); loadFolders().catch(() => {}); setRev((r) => r + 1); }}
          onCopyFrom={async (id, name) => { setDialog(null); await run(T.createBranch, async () => { const f = await api.createFolder(project.full_name, name, folder.path, id); await loadFolders(); pick(f.path); }); }} />
      )}
      {dialog === "save" && (
        <SaveDialog changes={changes} merge={mergeAfterSave} branch={folder.branch} onClose={() => { setDialog(null); setMergeAfterSave(false); setRequestAfterSave(false); }}
          onSave={async (msg, files, send) => {
            setDialog(null);
            const thenMerge = mergeAfterSave;
            setMergeAfterSave(false);
            if (thenMerge) {
              await run(T.commit, async () => { await api.save(folder.path, msg, files); });
              setDialog("merge");
            } else if (send) {
              await run(t("保存して送信"), async () => {
                await api.save(folder.path, msg, files);
                const r = classic ? await api.push(folder.path) : await api.sync(folder.path);
                if (r.result === "conflict") setMessage({ kind: "error", text: t("{0}しましたが、ほかの人が同じ箇所を変更しています（{1}）。あなたの変更はそのまま残しています。", [T.commit, r.files.join("、")]) });
                else if (r.result === "need_save") setMessage({ kind: "warn", text: t("{0}しました。選ばなかった変更が {1} 件残っているため、まだ送っていません。", [T.commit, r.changes]) });
                else setMessage(sentMessage(r.sent || 1, r.received));
              });
            } else {
              const back = requestAfterSave; setRequestAfterSave(false);
              await run(T.commit, async () => { await api.save(folder.path, msg, files); if (!back) setMessage({ kind: "ok", text: t("{0}しました（まだこのPCの中だけです）。送るには「{1}」を押してください。", [T.commit, T.sync]) }); });
              if (back) setDialog("request");
            }
          }} />
      )}
      {dialog === "newFolder" && (
        <PromptDialog title={folder.is_main ? T.createBranch : t("{0} から下書きを作る", [copyText(nums[folder.name], folder.branch)])} label={t("名前（例：見積書の修正）")} ok={t("作成")}
          note={folder.is_main
            ? t("{0}の最新の内容から、作業用の下書きを作ります。{1}には影響しません。", [T.mainBranch, T.mainBranch])
            : t("{0} の履歴保存済みの内容から、新しい下書きを作ります。{1}元のフォルダと{2}には影響しません。", [copyText(nums[folder.name], folder.branch), nChanges > 0 ? t("履歴未保存の変更 {0} 件は含まれません。必要なら先に履歴保存してください。", [nChanges]) : "", T.mainBranch])}
          onClose={() => setDialog(null)}
          onOk={(name) => { setDialog(null); return run(T.createBranch, async () => { const f = await api.createFolder(project.full_name, name, folder.is_main ? undefined : folder.path); await loadFolders(); pick(f.path); }); }} />
      )}
      {dialog === "request" && (
        <RequestDialog owner={project.owner} folder={folder} base={project.default_branch} nChanges={nChanges} commits={st?.not_in_main ?? 0}
          onCommit={() => { setRequestAfterSave(true); setDialog("save"); }}
          onClose={() => setDialog(null)}
          onOk={(title, msg) => { setDialog(null); return run(T.pullRequest, async () => { if (!classic && nChanges > 0) await api.save(folder.path, autoMessage(changes), []); const n = await api.sendRequest(project.full_name, folder.path, title, msg); setMessage({ kind: "ok", text: classic ? t("Pull request #{0} を作成しました（{1} → {2}）。", [n, folder.branch, project.default_branch], true) : t("反映依頼を送信しました。{0}さんの画面に通知されます。", [project.owner]) }); }); }} />
      )}
      {dialog === "merge" && (
        <MergeDialog folder={folder} base={project.default_branch} commits={st?.not_in_main ?? 0}
          onClose={() => setDialog(null)} onOk={() => { setDialog(null); if (nChanges > 0 && !classic) run(T.merge, async () => { await api.save(folder.path, autoMessage(changes), []); showMerge(await api.mergeFolder(project.full_name, folder.path, mergeTitle(folder))); }); else doMerge(); }} />
      )}
      {dialog === "requests" && (
        <RequestsPanel project={project} requests={requests} canMerge={!!cap?.can_review || cap?.mode === "direct"}
          onClose={() => setDialog(null)} onDone={(r) => { if (r) showMerge(r); loadRequests(); loadFolders().catch(() => {}); }} />
      )}
    </>
  );
}

function SaveDialog({ changes, merge, branch, onClose, onSave }: { changes: Change[]; merge?: boolean; branch: string; onClose: () => void; onSave: (msg: string, files: string[], send: boolean) => void }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(changes.map((x) => x.path)));
  const [msg, setMsg] = useState("");
  const all = checked.size === changes.length;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{classic ? `Commit（${branch}）` : merge ? t("{0}して{1}", [T.commit, T.merge]) : t("保存して送る")}</h3>
        {classic && <p className="muted">{t("commit するファイルを選んでください（チェックしたものだけ stage されます）。", undefined, true)}</p>}
        {!merge && !classic && <p className="muted">{t("今の状態を履歴に記録して、クラウドへ送ります。あとから「🕘 履歴」でこの時点に戻せます。")}</p>}
        {merge && !classic && <p className="muted">{t("履歴保存すると、そのまま{0}に反映します。", [T.mainBranch])}</p>}
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
        <label className="field">{classic ? "Commit message" : t("メッセージ（任意・空なら日時を記録）")}<input autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("例：見積金額を修正")} /></label>
        {classic ? (
        <div className="actions">
          <button onClick={onClose}>{t("キャンセル")}</button>
          {!merge && <button disabled={checked.size === 0 || !msg.trim()} onClick={() => onSave(msg.trim(), all ? [] : [...checked], true)}>Commit & Push</button>}
          <button className="primary" disabled={checked.size === 0 || !msg.trim()} onClick={() => onSave(msg.trim(), all ? [] : [...checked], false)}>{merge ? t("Commit して merge へ進む", undefined, true) : "Commit"}</button>
        </div>
        ) : (
        <div className="actions">
          <button onClick={onClose}>{t("キャンセル")}</button>
          {!merge && <button disabled={checked.size === 0} title={HELP.commitOnly} onClick={() => onSave(msg.trim() || t("{0} の{1}", [new Date().toLocaleString(LOCALE), T.commit]), all ? [] : [...checked], false)}>{t("送らずにこのPCだけに{0}", [T.commit])}</button>}
          <button className="primary" disabled={checked.size === 0} onClick={() => onSave(msg.trim() || t("{0} の{1}", [new Date().toLocaleString(LOCALE), T.commit]), all ? [] : [...checked], !merge)}>{merge ? t("{0}して{1}", [T.commit, T.merge]) : t("☁ 保存して送る")}</button>
        </div>)}
      </div>
    </div>
  );
}

/** 反映依頼（Pull request）：タイトルと説明。説明は空でもよい */
function RequestDialog({ owner, folder, base, nChanges, commits, onCommit, onClose, onOk }: {
  owner: string; folder: Folder; base: string; nChanges: number; commits: number; onCommit: () => void; onClose: () => void; onOk: (title: string, msg: string) => void;
}) {
  const [title, setTitle] = useState(classic ? folder.branch : t("{0} を本体へ反映", [folder.name]));
  const [msg, setMsg] = useState("");
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{T.pullRequest}</h3>
        <p className="muted">{classic ? t("{0} ← {1}（{2} commits）。未 push の commit は自動で push します。", [base, folder.branch, commits], true)
          : t("{0}さん（このフォルダの管理者）に、「{1}」の内容を{2}へ入れてもらうよう依頼します。まだ送っていない変更も自動で含めます。", [owner, folder.name, T.mainBranch])}</p>
        {nChanges > 0 && classic && <p className="warn-text">{classic ? t("未 commit の変更が {0} 件あります。含めるには先に commit してください。", [nChanges], true)
          : t("履歴未保存の変更が {0} 件あります。依頼に含めるには先に履歴保存してください。", [nChanges])}
          {" "}<button className="small" onClick={onCommit}>{classic ? "Commit…" : t("📝 履歴保存する…")}</button></p>}
        <label className="field">{classic ? "Title" : t("件名")}<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">{classic ? "Description" : t("{0}さんへのメッセージ（任意）", [owner])}<textarea rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
        <div className="actions">
          <button onClick={onClose}>{t("キャンセル")}</button>
          <button className="primary" disabled={!title.trim() || (commits === 0 && (classic || nChanges === 0))} title={commits === 0 && (classic || nChanges === 0) ? (classic ? t("PR に含める commit がありません", undefined, true) : t("依頼に含める履歴保存がありません")) : ""} onClick={() => onOk(title.trim(), msg)}>{t("依頼を送信")}</button>
        </div>
      </div>
    </div>
  );
}

/** 本体への反映（merge）の確認 */
function MergeDialog({ folder, base, commits, onClose, onOk }: { folder: Folder; base: string; commits: number; onClose: () => void; onOk: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{classic ? `Merge ${folder.branch} → ${base}` : t("「{0}」を本体に反映", [folder.name])}</h3>
        {classic ? (
          <ul className="muted">
            <li>base：<b>{base}</b> ← head：<b>{folder.branch}</b>（{commits} commits）</li>
            <li>{t("GitHub 上で Pull request を作って merge commit で merge します（squash / rebase はしません）。", undefined, true)}</li>
            <li>{t("未 push の commit は先に push します。merge 後、ローカルの main も pull します。", undefined, true)}</li>
          </ul>
        ) : (
          <p className="muted">{t("下書き「{0}」の変更を本体に取り込みます。本体はほかの人にも見えている内容です。", [folder.name])}</p>
        )}
        <div className="actions">
          <button onClick={onClose}>{t("キャンセル")}</button>
          <button className="primary" onClick={onOk}>{classic ? "Merge" : t("反映する")}</button>
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
  const done = useRef(false);
  const ok1 = () => { if (done.current || !v.trim()) return; done.current = true; onOk(v); }; // Enter 連打で2回作らない
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {note && <p className="muted">{note}</p>}
        <label className="field">{label}
          {multiline ? <textarea autoFocus rows={5} value={v} onChange={(e) => setV(e.target.value)} />
            : <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok1()} />}
        </label>
        <div className="actions">
          <button onClick={onClose}>{t("キャンセル")}</button>
          <button className="primary" disabled={disabled || !v.trim()} onClick={ok1}>{ok}</button>
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
