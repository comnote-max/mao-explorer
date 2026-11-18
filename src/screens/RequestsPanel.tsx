import { useEffect, useState } from "react";
import { api, ChangedFile, MergeView, Project, Request } from "../api";
import { T } from "../terms";
import { PromptDialog } from "./LocalView";

const branchLabel = (b: string, main: string) => (b === main ? T.mainBranch : b.replace(/^mao\//, ""));

export default function RequestsPanel({ project, requests, canMerge, onClose, onDone }: {
  project: Project; requests: Request[]; canMerge: boolean; onClose: () => void; onDone: (r?: MergeView) => void;
}) {
  const [sel, setSel] = useState<Request | null>(requests.find((r) => !r.mine) ?? requests[0] ?? null);
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    setFiles(null);
    if (sel) api.requestFiles(project.full_name, sel.number).then(setFiles).catch((e) => setErr(String(e)));
  }, [sel?.number]);

  const merge = async () => {
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.mergeRequest(project.full_name, sel.number, sel.base);
      onDone(r);
      if (r.result === "merged") onClose();
      else if (r.result === "blocked") setErr(r.reason);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>{T.pullRequests}</h3>
        <div className="req-layout">
          <ul className="req-list">
            {requests.length === 0 && <li className="muted">処理待ちの依頼はありません</li>}
            {requests.map((r) => (
              <li key={r.number} className={sel?.number === r.number ? "active" : ""} onClick={() => setSel(r)}>
                <div>{r.mine ? "📤 送信" : "📥 受信"}　{r.title}</div>
                <div className="muted small-text">{r.author}・{new Date(r.created_at).toLocaleString("ja-JP")}</div>
              </li>
            ))}
          </ul>
          {sel && (
            <div className="req-detail">
              <dl>
                <dt>依頼者</dt><dd>{sel.author}</dd>
                <dt>反映元</dt><dd>🗂 {branchLabel(sel.head, project.default_branch)}</dd>
                <dt>反映先</dt><dd>🏠 {branchLabel(sel.base, project.default_branch)}</dd>
                <dt>メッセージ</dt><dd className="pre">{sel.body || "（なし）"}</dd>
              </dl>
              <h4>変更されたファイル</h4>
              <div className="files">
                {!files && <p className="muted">読み込み中…</p>}
                {files?.map((f) => (
                  <details key={f.path}>
                    <summary>{f.path}　<span className="add">+{f.additions}</span> <span className="del">-{f.deletions}</span></summary>
                    <pre className="diff">{f.patch ? f.patch.split("\n").map((l, i) => (
                      <div key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "muted" : ""}>{l}</div>
                    )) : "（この形式のファイルは差分を表示できません）"}</pre>
                  </details>
                ))}
              </div>
              {err && <p className="error">{err}</p>}
              <div className="actions">
                <a className="muted small-text" href={sel.url} target="_blank" rel="noreferrer">GitHubで見る</a>
                <span className="grow" />
                {!sel.mine && <button onClick={() => setAsking(true)} disabled={busy}>{T.requestChanges}</button>}
                {canMerge && <button className="primary" onClick={merge} disabled={busy}>{busy ? "反映中…" : `⤴ ${T.merge}`}</button>}
              </div>
            </div>
          )}
        </div>
        <div className="actions"><button onClick={onClose}>閉じる</button></div>
      </div>
      {asking && sel && (
        <PromptDialog title={T.requestChanges} label="依頼者へのメッセージ" ok="送信" multiline onClose={() => setAsking(false)}
          onOk={async (m) => { setAsking(false); try { await api.requestChanges(project.full_name, sel.number, m); onDone(); setErr(null); } catch (e) { setErr(String(e)); } }} />
      )}
    </div>
  );
}
