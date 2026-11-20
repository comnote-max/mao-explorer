import { useEffect, useState } from "react";
import { api, Change, Folder, HistoryEntry } from "../api";
import { CHANGE_LABEL, T } from "../terms";
import { Diff } from "./Preview";
import { t, LOCALE , tErr, classic } from "../i18n";

const when = (s: number) => new Date(s * 1000).toLocaleString(LOCALE);

/** 🕘 履歴：履歴保存の一覧・中身の確認・巻き戻し。 */
export default function HistoryDialog({ folder, prefer, label, hasChanges, onClose, onDone, onCopyFrom }: {
  folder: Folder; prefer?: string; label: React.ReactNode; hasChanges: boolean;
  onClose: () => void; onDone: (msg: string) => void; onCopyFrom: (id: string, name: string) => Promise<void>;
}) {
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  const [sel, setSel] = useState<HistoryEntry | null>(null);
  const [files, setFiles] = useState<Change[] | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // 一覧で選んでいたファイルがあれば、そのファイルが変わった一番新しい時点を最初に選ぶ
    api.history(folder.path).then(async (l) => {
      setList(l);
      if (prefer) for (const h of l) { const fs = await api.historyFiles(folder.path, h.id).catch(() => [] as Change[]); if (fs.some((x) => x.path === prefer)) { setSel(h); return; } }
      setSel(l[0] ?? null);
    }).catch((e) => setErr(tErr(e)));
  }, [folder.path]);
  useEffect(() => {
    setFiles(null); setFile(null);
    if (sel) api.historyFiles(folder.path, sel.id).then((f) => { setFiles(f); setFile(f.find((x) => x.path === prefer)?.path ?? f[0]?.path ?? null); }).catch((e) => setErr(tErr(e)));
  }, [sel?.id]);
  useEffect(() => {
    setDiff(undefined);
    if (sel && file) api.historyDiff(folder.path, sel.id, file).then(setDiff).catch(() => setDiff(null));
  }, [sel?.id, file]);

  const title = (h: HistoryEntry) => {
    const first = h.message.split("\n")[0];
    const m = first.match(/^Merge pull request #\d+ from [^/]+\/(?:mao\/)?(.+)$/);
    if (m) return t("「{0}」を{1}に反映", [m[1], T.mainBranch]);
    if (/^Merge (branch|remote-tracking branch)/.test(first)) return t("{0}で取り込み", [T.sync]);
    if (first === "Initial commit") return t("最初の状態");
    return first || t("（メッセージなし）");
  };
  const act = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr(tErr(e)); } finally { setBusy(false); }
  };

  const restoreFile = () => sel && file && act(async () => {
    if (!window.confirm(t("「{0}」を、{1}「{2}」の時点の中身に戻します。\n\n今の中身は「{3}」していなければ失われますが、履歴保存済みの内容はいつでもこの画面から取り戻せます。", [file, when(sel.time), title(sel), T.commit]))) return;
    await api.restoreFile(folder.path, sel.id, file);
    onDone(classic ? t("「{0}」を {1} の時点に戻しました。よければ「{2}」してください。", [file, when(sel.time), T.commit])
      : t("「{0}」を {1} の時点に戻しました。", [file, when(sel.time)]));
  });
  const restoreAll = () => sel && act(async () => {
    if (hasChanges) { setErr(t("{0}していない変更があります。先に{1}してから戻してください。", [T.commit, T.commit])); return; }
    if (!window.confirm(t("フォルダ全体を、{0}「{1}」の時点の状態に戻します。\n\nこれより後の履歴は消さずに残し、「この時点に戻した」という新しい{2}を追加します。あとから元に戻すこともできます。", [when(sel.time), title(sel), T.commit]))) return;
    await api.restoreAll(folder.path, sel.id);
    onDone(t("{0} の時点に戻しました（新しい{1}として記録しました）。", [when(sel.time), T.commit]));
  });
  const copyFrom = () => sel && act(async () => {
    const name = window.prompt(t("{0}「{1}」の時点から、新しい下書きを作ります。\n今のフォルダには影響しません。\n\n下書きの名前：", [when(sel.time), title(sel)]), t("{0}の時点", [title(sel).slice(0, 20)]));
    if (!name?.trim()) return;
    await onCopyFrom(sel.id, name.trim());
  });

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide history" onClick={(e) => e.stopPropagation()}>
        <h3>🕘 {t("履歴")} ― {label}</h3>
        {err && <div className="error">{err}</div>}
        <div className="history-body">
          <div className="history-list">
            {!list && <p className="muted">{t("読み込み中…")}</p>}
            {list?.map((h, i) => (
              <div key={h.id} className={"history-item" + (sel?.id === h.id ? " on" : "")} onClick={() => setSel(h)}>
                <div className="history-title">{i === 0 && <span className="badge">{t("いま")}</span>} {classic && <code className="muted">{h.id.slice(0, 7)}</code>} {title(h)}</div>
                <div className="muted small-text">{when(h.time)}・{h.author}{h.local_only && t("・📤 未送信")}</div>
              </div>
            ))}
          </div>
          <div className="history-detail">
            {sel && <>
              <div className="history-actions">
                <button disabled={busy || !file} onClick={restoreFile} title={t("選んでいるファイルだけを、この時点の中身に戻します")}>{t("↩ このファイルを戻す")}</button>
                <button disabled={busy || list?.[0]?.id === sel.id} onClick={restoreAll} title={t("フォルダ全体をこの時点の状態に戻します（後の履歴は残ります）")}>{t("⏪ フォルダ全体をこの時点に戻す")}</button>
                <button disabled={busy} onClick={copyFrom} title={t("この時点の状態から、新しい下書きを作ります")}>{t("＋ この時点から下書きを作る")}</button>
              </div>
              <div className="history-files">
                {!files && <p className="muted">{t("読み込み中…")}</p>}
                {files?.length === 0 && <p className="muted">{t("変わったファイルはありません")}</p>}
                {files?.map((f) => (
                  <div key={f.path} className={"history-file" + (file === f.path ? " on" : "")} onClick={() => setFile(f.path)}>
                    <span className={`mark ${f.kind}`}>{CHANGE_LABEL[f.kind] ?? f.kind}</span> {f.path}
                  </div>
                ))}
              </div>
              <div className="history-diff">
                {!file ? null : diff === undefined ? <p className="muted">{t("読み込み中…")}</p>
                  : diff === null ? <p className="muted">{t("文字のファイルではないため、変更点を表示できません（「このファイルを戻す」は使えます）")}</p>
                  : <Diff text={diff} />}
              </div>
            </>}
          </div>
        </div>
        <div className="actions"><button onClick={onClose}>{t("閉じる")}</button></div>
      </div>
    </div>
  );
}
