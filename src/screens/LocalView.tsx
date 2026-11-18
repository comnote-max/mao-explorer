import { useCallback, useEffect, useState } from "react";
import { api, Capability, Change, Folder, MergeView, Project, Request } from "../api";
import { CHANGE_LABEL, T } from "../terms";
import { copyNumbers, copyText, CopyTag } from "../copyNo";
import FileBrowser from "./FileBrowser";
import RequestsPanel from "./RequestsPanel";
import { isUnder } from "./FolderTree";

type Dialog = null | "save" | "newFolder" | "request" | "requests";

const seenKey = (fn: string) => `mao.seenRequests.${fn}`;
const loadSeen = (fn: string): number[] => {
  try { return JSON.parse(localStorage.getItem(seenKey(fn)) ?? "[]"); } catch { return []; }
};

/** 同期済みプロジェクト：通常のファイル一覧に、GitHub の操作グループを足したもの。 */
export default function LocalView({ project, cap, path, onPathChange }: {
  project: Project; cap: Capability | null; path?: string; onPathChange?: (p: string) => void;
}) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [current, setCurrent] = useState<string>("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
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
    loadFolders().catch((e) => setMessage({ kind: "error", text: String(e) }));
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

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try { await f(); } catch (e) { setMessage({ kind: "error", text: `${label}に失敗しました：${e}（ローカルの変更はそのまま残っています）` }); }
    finally { setBusy(null); await loadFolders().catch(() => {}); loadChanges(); loadRequests(); }
  };

  const doSync = () => run(T.sync, async () => {
    if (!folder) return;
    const r = await api.sync(folder.path);
    if (r.result === "need_save") {
      setMessage({ kind: "warn", text: `未保存の変更が ${r.changes} 件あります。先に「${T.commit}」してください。` });
      setDialog("save");
    } else if (r.result === "conflict") {
      setMessage({ kind: "error", text: `${T.attention}：GitHub側と同じ箇所が変更されています（${r.files.join("、")}）。あなたの変更はそのまま残しています。` });
    } else {
      setMessage({ kind: "ok", text: `${T.synced}（取得 ${r.received}・送信 ${r.sent}）` });
    }
  });

  const showMerge = (r: MergeView) => {
    if (r.result === "merged") setMessage({ kind: "ok", text: `${T.merged}です（GitHub上の本体で確認しました）` });
    else if (r.result === "blocked") setMessage({ kind: "warn", text: `本体へはまだ反映されていません：${r.reason}　依頼は残っています。` });
    else setMessage({ kind: "warn", text: "GitHubは受け付けましたが、本体での反映をまだ確認できません。少し待ってから同期してください。" });
  };

  // クラウドドライブのように：手元に変更がなく、GitHub側が新しければ自動で取り込む
  const behind = folder?.state.behind ?? 0;
  useEffect(() => {
    if (!folder || busy || behind === 0 || changes.length > 0) return;
    setBusy(T.sync);
    api.sync(folder.path).catch(() => {}).finally(() => { setBusy(null); loadFolders().catch(() => {}); loadChanges(); });
  }, [folder?.path, behind, changes.length]);

  const doMerge =() => run(T.merge, async () => showMerge(await api.mergeFolder(project.full_name, folder!.path, `${folder!.name} を本体に反映`)));

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
  const myRequest = folder && requests.find((r) => r.mine && r.head === folder.branch);
  const hasWork = !!folder && !folder.is_main && (st!.not_in_main > 0 || nChanges > 0);
  const statusText = !st ? "" : busy ? `⟳ ${busy}中…`
    : nChanges > 0 ? `● ${T.localChanges} ${nChanges} 件`
    : st.unpublished ? "↑ 未送信（GitHubにまだありません）"
    : st.ahead || st.behind ? `⇅ ${T.pending}（送信 ${st.ahead}・取得 ${st.behind}）`
    : `✔ ${T.synced}`;
  const mergeText = folder && !folder.is_main && st
    ? st.not_in_main === 0 && nChanges === 0 ? `✔ ${T.merged}（または変更なし）` : myRequest ? "✉ 反映依頼中" : `本体に未反映`
    : null;

  const gitTools = (
    <div className="gitgroup">
      <button onClick={() => setDialog("newFolder")} disabled={!!busy}
        title={folder?.is_main ? "本体の最新の内容をコピーして、作業用のフォルダを作ります" : "このコピーの保存済みの内容から、新しいコピーを作ります"}>
        ＋ {!folder || folder.is_main ? T.createBranch : <><CopyTag n={nums[folder.name]} /> をコピー</>}
      </button>
      <button onClick={doSync} disabled={!!busy}>⇅ {T.sync}</button>
      <button onClick={() => setDialog("save")} disabled={!!busy || !nChanges} className={nChanges ? "primary" : ""}>
        💾 {T.commit}{nChanges ? `（${nChanges}）` : ""}
      </button>
      {hasWork && cap?.mode === "request" && (
        <button className="primary" onClick={() => setDialog("request")} disabled={!!busy}>✉ {myRequest ? "反映依頼中（追記）" : T.pullRequest}</button>
      )}
      {hasWork && cap?.mode === "direct" && (
        <button className="primary" disabled={!!busy} title={nChanges > 0 ? "未保存の変更を保存してから反映します" : ""}
          onClick={() => { if (nChanges > 0) { setMergeAfterSave(true); setDialog("save"); } else doMerge(); }}>
          ⤴ {T.merge}
        </button>
      )}
      {(cap?.can_review || requests.length > 0) && (
        <button className={unseen > 0 ? "blink" : ""} onClick={openRequests}>📨 {T.pullRequests}{incoming.length ? `（${incoming.length}）` : ""}</button>
      )}
    </div>
  );

  if (!folder) return <p className="muted pad">{message?.text ?? "読み込み中…"}</p>;

  return (
    <>
      {message && <div className={`banner ${message.kind}`}>{message.text}<button className="small" onClick={() => setMessage(null)}>×</button></div>}
      <FileBrowser key={folder.path} path={path && isUnder(path, folder.path) ? path : folder.path} onPathChange={onPathChange} rootLimit={folder.path}
        rootLabel={tagOf(folder)}
        gitRoot={folder.path} gitChanges={changes} extraTools={gitTools}
        extraStatus={<>{statusText}{mergeText && `　｜　${mergeText}`}</>}
        onMutate={loadChanges} />

      {dialog === "save" && (
        <SaveDialog changes={changes} merge={mergeAfterSave} onClose={() => { setDialog(null); setMergeAfterSave(false); }}
          onSave={async (msg, files) => {
            setDialog(null);
            const thenMerge = mergeAfterSave;
            setMergeAfterSave(false);
            if (thenMerge) {
              await run(T.merge, async () => {
                await api.save(folder.path, msg, files);
                showMerge(await api.mergeFolder(project.full_name, folder.path, `${folder.name} を本体に反映`));
              });
            } else {
              await run(T.commit, async () => { await api.save(folder.path, msg, files); setMessage({ kind: "ok", text: `${T.commit}しました。GitHubへ送るには「${T.sync}」を押してください。` }); });
            }
          }} />
      )}
      {dialog === "newFolder" && (
        <PromptDialog title={folder.is_main ? T.createBranch : `${copyText(nums[folder.name])} をコピー`} label="名前（例：見積書の修正）" ok="作成"
          note={folder.is_main
            ? `${T.mainBranch}の最新の内容をコピーした、作業用のフォルダを作ります。${T.mainBranch}には影響しません。`
            : `${copyText(nums[folder.name])} の保存済みの内容から、新しいコピーを作ります。${nChanges > 0 ? `未保存の変更 ${nChanges} 件はコピーされません。必要なら先に保存してください。` : ""}元のフォルダと${T.mainBranch}には影響しません。`}
          onClose={() => setDialog(null)}
          onOk={(name) => { setDialog(null); return run(T.createBranch, async () => { const f = await api.createFolder(project.full_name, name, folder.is_main ? undefined : folder.path); await loadFolders(); pick(f.path); }); }} />
      )}
      {dialog === "request" && (
        <PromptDialog title={T.pullRequest} label="責任者へのメッセージ" ok="依頼を送信" multiline
          note={nChanges > 0 ? `未保存の変更が ${nChanges} 件あります。先に保存してください。` : `「${folder.name}」の内容を、${T.mainBranch}へ反映するよう依頼します。未送信の保存は自動で送信します。`}
          disabled={nChanges > 0}
          onClose={() => setDialog(null)}
          onOk={(msg) => { setDialog(null); return run(T.pullRequest, async () => { await api.sendRequest(project.full_name, folder.path, `${folder.name} を本体へ反映`, msg); setMessage({ kind: "ok", text: "反映依頼を送信しました。責任者の画面に通知されます。" }); }); }} />
      )}
      {dialog === "requests" && (
        <RequestsPanel project={project} requests={requests} canMerge={!!cap?.can_review || cap?.mode === "direct"}
          onClose={() => setDialog(null)} onDone={(r) => { if (r) showMerge(r); loadRequests(); loadFolders().catch(() => {}); }} />
      )}
    </>
  );
}

function SaveDialog({ changes, merge, onClose, onSave }: { changes: Change[]; merge?: boolean; onClose: () => void; onSave: (msg: string, files: string[]) => void }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(changes.map((x) => x.path)));
  const [msg, setMsg] = useState("");
  const all = checked.size === changes.length;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{merge ? `${T.commit}して${T.merge}` : `${T.commit}（変更を履歴に記録）`}</h3>
        {merge && <p className="muted">保存すると、そのまま{T.mainBranch}に反映します（GitHub上で依頼の作成と反映を自動で行います）。</p>}
        <div className="changes">
          {changes.map((c) => (
            <label key={c.path}>
              <input type="checkbox" checked={checked.has(c.path)}
                onChange={(e) => { const s = new Set(checked); e.target.checked ? s.add(c.path) : s.delete(c.path); setChecked(s); }} />
              <span className={`mark ${c.kind}`}>{CHANGE_LABEL[c.kind] ?? c.kind}</span> {c.path}
            </label>
          ))}
          {changes.length === 0 && <p className="muted">変更はありません</p>}
        </div>
        <label className="field">メッセージ（任意・空なら日時を記録）<input autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="例：見積金額を修正" /></label>
        <div className="actions">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" disabled={checked.size === 0} onClick={() => onSave(msg.trim() || `${new Date().toLocaleString("ja-JP")} の${T.commit}`, all ? [] : [...checked])}>{merge ? `${T.commit}して${T.merge}` : T.commit}</button>
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
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" disabled={disabled || !v.trim()} onClick={() => onOk(v)}>{ok}</button>
        </div>
      </div>
    </div>
  );
}
