import { Project } from "../api";
import { ACCESS_LABEL, T } from "../terms";

export default function ProjectList({
  projects, error, onOpen, onReload,
}: { projects: Project[] | null; error: string | null; onOpen: (p: Project) => void; onReload: () => void }) {
  return (
    <>
      <div className="navbar">
        <div className="address">🐙 GitHub</div>
        <button onClick={onReload}>↻ 更新</button>
      </div>
      {error && <p className="error pad">{error}</p>}
      {!projects && !error && <p className="muted pad">読み込み中…</p>}
      {projects && (
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
      <div className="statusbar">{projects ? `${projects.length} 個の${T.repository}` : ""}</div>
    </>
  );
}
