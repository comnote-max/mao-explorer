import { ReactNode, useEffect, useState } from "react";
import { api, fsApi, Project } from "../api";
import { T } from "../terms";
import { copyNumbers, CopyTag } from "../copyNo";

const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
export const isUnder = (child: string, parent: string) => {
  const c = norm(child), p = norm(parent);
  return c === p || c.startsWith(p + "\\") || c.startsWith(p + "/");
};

/** エクスプローラーと同じ、開閉できるフォルダーツリー（中身は開いた時に読む）。 */
export function TreeNode({ path, label, icon, depth, current, onSelect, extra, extraCount = 0, defaultOpen = false }: {
  path: string; label: ReactNode; icon: string; depth: number; current: string | null; onSelect: (p: string) => void;
  extra?: ReactNode; extraCount?: number; defaultOpen?: boolean;
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
      <div className={"tree-item" + (active ? " active" : "")} style={{ paddingLeft: 8 + depth * 14 }} title={path}
        onClick={() => onSelect(path)} onDoubleClick={toggle}>
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
  const [folders, setFolders] = useState<{ name: string; path: string; is_main: boolean }[] | null>(null);
  const load = () => api.folders(project.full_name).then(setFolders).catch(() => setFolders([]));

  useEffect(() => { if (active && project.synced) { setOpen(true); load(); } }, [active, current]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!project.synced) return;
    if (!open) load();
    setOpen(!open);
  };
  const main = folders?.find((f) => f.is_main);
  const virt = folders?.filter((f) => !f.is_main) ?? [];
  const nums = copyNumbers(project.full_name, virt.map((f) => f.name));
  virt.sort((a, b) => nums[a.name] - nums[b.name]);

  return (
    <>
      <div className={"tree-item" + (active && !current ? " active" : "") + (project.synced ? "" : " unsynced")}
        style={{ paddingLeft: 22 }} title={project.full_name} onClick={() => onSelect()} onDoubleClick={toggle}>
        <span className="twisty" onClick={toggle}>{project.synced ? (open ? "▾" : "▸") : ""}</span>
        📦 {project.name} {project.private && <span className="lock">🔒</span>}
      </div>
      {open && main && (
        <TreeNode path={main.path} label={T.mainBranch} icon="🏠" depth={2} current={current} onSelect={onSelect}
          extraCount={virt.length} defaultOpen
          extra={virt.map((f) => (
            <TreeNode key={f.path} path={f.path} label={<><CopyTag n={nums[f.name]} /> {f.name}</>} icon="" depth={3} current={current} onSelect={onSelect} />
          ))} />
      )}
    </>
  );
}
