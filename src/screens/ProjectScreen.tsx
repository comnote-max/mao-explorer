import { useEffect, useState } from "react";
import { api, Capability, dispDesc, dispName, Project } from "../api";
import { ACCESS_LABEL, T } from "../terms";
import RemoteView from "./RemoteView";
import LocalView from "./LocalView";
import Members from "./Members";
import { t , tErr } from "../i18n";

export default function ProjectScreen({ project, onChanged, path, onPathChange, canBack, onBack, onUp }: {
  project: Project; onChanged: (p: Project) => void; path?: string; onPathChange?: (p: string) => void;
  canBack?: boolean; onBack?: () => void; onUp?: () => void;
}) {
  const [cap, setCap] = useState<Capability | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  useEffect(() => {
    api.capability(project.full_name).then(setCap).catch((e) => setCapError(tErr(e)));
  }, [project.full_name]);

  const [switching, setSwitching] = useState(false);
  const toggleVisibility = async () => {
    if (project.access !== "admin" || switching) return;
    const toPublic = project.private;
    const msg = toPublic
      ? t("「{0}」を{1}にします。\n\n世界中の誰でも中身を見られるようになります（履歴の中の過去のファイルも含みます）。パスワードや個人情報が入っていないか確認してください。\n\n本当に{2}にしますか？", [project.name, T.public, T.public])
      : t("「{0}」を{1}にします。\n招待した人以外は見られなくなります。よろしいですか？", [project.name, T.private]);
    if (!window.confirm(msg)) return;
    setSwitching(true);
    try { onChanged(await api.setPrivate(project.full_name, !toPublic)); }
    catch (e) { window.alert(t("切り替えられませんでした：{0}", [tErr(e)])); }
    finally { setSwitching(false); }
  };

  return (
    <>
      <header className="proj-head">
        <h2>{dispName(project)}</h2>
        <span className={"badge big clickable " + (project.private ? "private" : "public")}
          title={(project.private ? t("招待した人だけが見られます（右の「👥 共有」で招待）") : t("世界中の誰でも見られます")) + "\n" + (project.access === "admin" ? t("クリックで{0}に切り替え", [project.private ? T.public : T.private]) : t("切り替えには管理者の権限が必要です"))}
          onClick={toggleVisibility}>
          {project.private ? `🔒 ${T.private}` : `🌐 ${T.public}`}
        </span>
        <span className="badge">{ACCESS_LABEL[project.access]}</span>
        <span className="muted" title={cap ? tErr(cap.note) : undefined}>
          {cap
            ? cap.mode === "direct" ? t("✔ {0}できます", [T.merge]) : cap.mode === "request" ? t("✉ {0}で反映します", [T.pullRequest]) : t("反映操作はありません")
            : capError ? t("権限を確認できません") : T.checking}
        </span>
        <span className="muted grow">{dispDesc(project)}</span>
        <span id="proj-head-slot" />
        {project.synced && project.main && (
          <button title={project.main} onClick={async () => {
            if (!(await api.openInDesktop(project.main!))) window.alert(t("GitHub Desktop が見つかりません。インストールすると、同じフォルダを開けます。"));
          }}>{t("GitHub Desktop で開く")}</button>
        )}
        <Members project={project} />
      </header>
      {project.synced ? (
        <LocalView project={project} cap={cap} path={path} onPathChange={onPathChange} canBack={canBack} onBack={onBack} onUp={onUp} />
      ) : (
        <RemoteView project={project} canBack={canBack} onBack={onBack} onUp={onUp} onSynced={() => api.projectInfo(project.full_name).then(onChanged)} />
      )}
    </>
  );
}
