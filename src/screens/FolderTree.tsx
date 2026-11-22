import { ReactNode, useEffect, useState } from "react";
import { api, dispName, Folder, fsApi, Project } from "../api";
import { T } from "../terms";
import { copyNumbers, CopyTag } from "../copyNo";
import { t , tErr } from "../i18n";
import { dropProps } from "../dnd";

const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
export const isUnder = (child: string, parent: string) => {
  const c = norm(child), p = norm(parent);
  return c === p || c.startsWith(p + "\\") || c.startsWith(p + "/");
};

/** エクスプローラーと同じ、開閉できるフォルダーツリー（中身は開いた時に読む）。 */
export function TreeNode({ path, label, icon, depth, current, onSelect, extra, extraCount = 0, defaultOpen = false, onMenu }: {
  path: string; label: ReactNode; icon: string; depth: number; current: string | null; onSelect: (p: string) => void;
  extra?: ReactNode; extraCount?: number; defaultOpen?: boolean; onMenu?: (e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [kids, setKids] = useState<{ name: string; path: string }[] | null>(null);
  const active = current !== null && norm(current) === norm(path);
  useEffect(() => { if (defaultOpen && !kids) load(); }, []);

  const load = () =>
    fsApi.list(path, false)
      .then((es) => setKids(es.filter((e) => e.is_dir).sort((a, b) => a.name.localeCompare(b.name, "ja")).map((e) => ({ name: e.name, path: e.path }))))
      .catch(() => setKids([]));

  // 右側で開いた場所に合わせて、ツリーも自動で開く
  useEffect(() => {
    if (current && !active && isUnder(current, path) && !open) { setOpen(true); if (!kids) load(); }
  }, [current]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && !kids) load();
    setOpen(!open);
  };

  return (
    <>
      <div className={"tree-item" + (active ? " active" : "")} style={{ paddingLeft: 8 + depth * 14 }} title={path} {...dropProps(path)}
        onClick={() => onSelect(path)} onDoubleClick={toggle}
        onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(e); } : undefined}>
        <span className="twisty" onClick={toggle}>{kids && kids.length === 0 && extraCount === 0 ? "" : open ? "▾" : "▸"}</span>
        {icon && <>{icon} </>}{label}
      </div>
      {open && extra}
      {open && kids?.map((k) => (
        <TreeNode key={k.path} path={k.path} label={k.name} icon="📁" depth={depth + 1} current={current} onSelect={onSelect} />
      ))}
    </>
  );
}


/** GitHub のプロジェクト：🏠本体 の下に 🗂仮想フォルダ が並ぶツリー。 */
export function ProjectNode({ project, active, current, onSelect }: {
  project: Project; active: boolean; current: string | null; onSelect: (path?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; f: Folder } | null>(null);
  useEffect(() => { if (!menu) return; const c = () => setMenu(null); window.addEventListener("click", c); return () => window.removeEventListener("click", c); }, [menu]);
  const load = () => api.folders(project.full_name).then(setFolders).catch(() => setFolders([]));

  useEffect(() => { if (active && project.synced) { setOpen(true); load(); } }, [active, current, project.synced]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!project.synced) return;
    if (!open) load();
    setOpen(!open);
  };
  const main = folders?.find((f) => f.is_main);

  const remove = async (f: Folder) => {
    setMenu(null);
    const tag = `copy${String(nums[f.name]).padStart(2, "0")} ${f.name}`;
    const unsaved = f.state.changes > 0;
    const unmerged = f.state.not_in_main > 0;
    const msg = [
      t("「{0}」を削除します。", [tag]),
      unsaved ? t("・履歴未保存の変更が {0} 件あります。", [f.state.changes]) : "",
      unmerged ? t("・{0}に未反映の{1}があります。クラウドには残すので、あとから取り戻せます。", [T.mainBranch, T.commit]) : t("・{0}に反映済みなので、クラウドからも片付けます。", [T.mainBranch]),
      t("フォルダはごみ箱へ移します（ごみ箱から元に戻せます）。"),
    ].filter(Boolean).join("\n");
    if (!window.confirm(msg)) return;
    try {
      await api.removeFolder(project.full_name, f.path, !unmerged);
      if (current && isUnder(current, f.path) && main) onSelect(main.path);
      load();
    } catch (e) { window.alert(t("削除できませんでした：{0}", [tErr(e)])); }
  };
  const virt = folders?.filter((f) => !f.is_main) ?? [];
  const nums = copyNumbers(project.full_name, virt.map((f) => f.name));
  virt.sort((a, b) => nums[a.name] - nums[b.name]);

  return (
    <>
      <div className={"tree-item" + (active && !current ? " active" : "") + (project.synced ? "" : " unsynced")}
        style={{ paddingLeft: 22 }} title={project.full_name} onClick={() => onSelect()} onDoubleClick={toggle}>
        <span className="twisty" onClick={toggle}>{project.synced ? (open ? "▾" : "▸") : ""}</span>
        ☁ {dispName(project)} {project.private && <span className="lock">🔒</span>}
      </div>
      {open && main && (
        <TreeNode path={main.path} label={T.mainBranch} icon="🏠" depth={2} current={current} onSelect={onSelect}
          extraCount={virt.length} defaultOpen
          extra={virt.map((f) => (
            <TreeNode key={f.path} path={f.path} label={<span style={f.state.not_in_main === 0 && f.state.changes === 0 && !f.state.unpublished ? { opacity: 0.5 } : undefined} title={f.state.not_in_main === 0 && f.state.changes === 0 && !f.state.unpublished ? t("本体に反映済み（右クリックで片付けられます）") : undefined}><CopyTag n={nums[f.name]} /> {f.name}{f.state.not_in_main === 0 && f.state.changes === 0 && !f.state.unpublished ? " ✔" : ""}</span>} onMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, f })} icon="" depth={3} current={current} onSelect={onSelect} />
          ))} />
      )}
      {menu && (
        <div className="menu" style={{ position: "fixed", left: menu.x, top: menu.y }}>
          <div onClick={() => onSelect(menu.f.path)}>{t("開く")}</div>
          <hr />
          <div onClick={() => remove(menu.f)}>{t("🗑 この下書きを削除")}</div>
        </div>
      )}
    </>
  );
}
