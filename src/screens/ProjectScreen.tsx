import { useEffect, useState } from "react";
import { api, Capability, Project } from "../api";
import { ACCESS_LABEL, T } from "../terms";
import RemoteView from "./RemoteView";
import LocalView from "./LocalView";

export default function ProjectScreen({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const [cap, setCap] = useState<Capability | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  useEffect(() => {
    api.capability(project.full_name).then(setCap).catch((e) => setCapError(String(e)));
  }, [project.full_name]);

  return (
    <>
      <header className="proj-head">
        <h2>{project.name}</h2>
        <span className={"badge big " + (project.private ? "private" : "public")}>
          {project.private ? `🔒 ${T.private}` : `🌐 ${T.public}`}
        </span>
        <span className="badge">{ACCESS_LABEL[project.access]}</span>
        <span className="muted" title={cap?.note}>
          {cap
            ? cap.mode === "direct" ? `✔ ${T.merge}できます` : cap.mode === "request" ? `✉ ${T.pullRequest}で反映します` : "反映操作はありません"
            : capError ? "権限を確認できません" : T.checking}
        </span>
        <span className="muted grow">{project.description}</span>
      </header>
      {project.synced ? (
        <LocalView project={project} cap={cap} />
      ) : (
        <RemoteView project={project} onSynced={() => api.projectInfo(project.full_name).then(onChanged)} />
      )}
    </>
  );
}
