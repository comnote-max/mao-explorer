import { useEffect, useState } from "react";
import { api, Capability, Project } from "../api";
import { ACCESS_LABEL, T } from "../terms";
import RemoteView from "./RemoteView";
import LocalView from "./LocalView";
import Members from "./Members";

export default function ProjectScreen({ project, onChanged, path, onPathChange }: {
  project: Project; onChanged: (p: Project) => void; path?: string; onPathChange?: (p: string) => void;
}) {
  const [cap, setCap] = useState<Capability | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  useEffect(() => {
    api.capability(project.full_name).then(setCap).catch((e) => setCapError(String(e)));
  }, [project.full_name]);

  const [switching, setSwitching] = useState(false);
  const toggleVisibility = async () => {
    if (project.access !== "admin" || switching) return;
    const toPublic = project.private;
    const msg = toPublic
      ? `「${project.name}」を${T.public}にします。

世界中の誰でも中身を見られるようになります（履歴の中の過去のファイルも含みます）。パスワードや個人情報が入っていないか確認してください。

本当に${T.public}にしますか？`
      : `「${project.name}」を${T.private}にします。
招待した人以外は見られなくなります。よろしいですか？`;
    if (!window.confirm(msg)) return;
    setSwitching(true);
    try { onChanged(await api.setPrivate(project.full_name, !toPublic)); }
    catch (e) { window.alert(`切り替えられませんでした：${e}`); }
    finally { setSwitching(false); }
  };

  return (
    <>
      <header className="proj-head">
        <h2>{project.name}</h2>
        <span className={"badge big clickable " + (project.private ? "private" : "public")}
          title={project.access === "admin" ? `クリックで${project.private ? T.public : T.private}に切り替え` : "切り替えには管理者の権限が必要です"}
          onClick={toggleVisibility}>
          {project.private ? `🔒 ${T.private}` : `🌐 ${T.public}`}
        </span>
        <span className="badge">{ACCESS_LABEL[project.access]}</span>
        <span className="muted" title={cap?.note}>
          {cap
            ? cap.mode === "direct" ? `✔ ${T.merge}できます` : cap.mode === "request" ? `✉ ${T.pullRequest}で反映します` : "反映操作はありません"
            : capError ? "権限を確認できません" : T.checking}
        </span>
        <span className="muted grow">{project.description}</span>
        <Members project={project} />
      </header>
      {project.synced ? (
        <LocalView project={project} cap={cap} path={path} onPathChange={onPathChange} />
      ) : (
        <RemoteView project={project} onSynced={() => api.projectInfo(project.full_name).then(onChanged)} />
      )}
    </>
  );
}
