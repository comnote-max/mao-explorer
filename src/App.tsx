import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Login from "./screens/Login";
import ProjectList from "./screens/ProjectList";
import ProjectScreen from "./screens/ProjectScreen";
import FileBrowser from "./screens/FileBrowser";
import { ProjectNode, TreeNode } from "./screens/FolderTree";
import { api, fsApi, Place, Project } from "./api";
import { T } from "./terms";

export type Account = { login: string; name: string | null; avatar_url: string };

type Loc = { kind: "fs"; path: string } | { kind: "github" } | { kind: "project"; project: Project; path?: string };

export default function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [open, setOpen] = useState({ pc: true, github: true });

  const refresh = () =>
    invoke<Account | null>("auth_account")
      .then(setAccount)
      .catch((e) => { setError(String(e)); setAccount(null); });

  const loadProjects = () => {
    setListError(null);
    api.projects().then(setProjects).catch((e) => setListError(String(e)));
  };

  useEffect(() => {
    refresh();
    fsApi.places().then((ps) => {
      setPlaces(ps);
      const home = ps.find((x) => x.kind === "quick");
      if (home) setLoc((l) => l ?? { kind: "fs", path: home.path });
    });
  }, []);
  useEffect(() => { if (account) loadProjects(); }, [account]);

  const isFs = (path: string) => loc?.kind === "fs" && loc.path === path;
  const isProject = (fn: string) => loc?.kind === "project" && loc.project.full_name === fn;

  return (
    <div className="shell">
      <aside className="tree">
        <div className="tree-item" onClick={() => setOpen({ ...open, pc: !open.pc })}>{open.pc ? "▾" : "▸"} 💻 PC</div>
        {open.pc && places.map((pl) => (
          <TreeNode key={pl.path} path={pl.path} label={pl.name} icon={pl.kind === "drive" ? "💽" : "⭐"} depth={1}
            current={loc?.kind === "fs" ? loc.path : null} onSelect={(path) => setLoc({ kind: "fs", path })} />
        ))}
        <div className="tree-item disabled" title="次の段階で実装（OSで接続済みの共有はドライブとして表示されます）">🗄 NAS</div>
        <div className="tree-item disabled" title="次の段階で実装">☁ OneDrive</div>
        <div className="tree-item disabled" title="次の段階で実装">☁ Google Drive</div>
        <div className={"tree-item" + (loc?.kind === "github" ? " active" : "")} onClick={() => { setLoc({ kind: "github" }); setOpen({ ...open, github: true }); }}>
          <span onClick={(e) => { e.stopPropagation(); setOpen({ ...open, github: !open.github }); }}>{open.github ? "▾" : "▸"}</span> 🐙 GitHub
        </div>
        {open.github && account && projects?.map((p) => (
          <ProjectNode key={p.full_name} project={p} active={isProject(p.full_name)}
            current={loc?.kind === "project" && loc.project.full_name === p.full_name ? loc.path ?? null : null}
            onSelect={(path) => setLoc({ kind: "project", project: p, path })} />
        ))}
        <div className="tree-foot">
          {account ? (
            <>
              <img src={account.avatar_url} alt="" width={20} height={20} className="avatar" />
              <span>{account.name ?? account.login}</span>
              <button className="small" onClick={() => invoke("logout").then(() => { setAccount(null); setProjects(null); if (loc?.kind !== "fs") setLoc({ kind: "github" }); })}>{T.logout}</button>
            </>
          ) : <span className="muted">GitHub 未接続</span>}
        </div>
      </aside>
      <section className="pane">
        {loc?.kind === "fs" && <FileBrowser path={loc.path} onPathChange={(path) => setLoc({ kind: "fs", path })} />}
        {loc?.kind === "github" && (account === null
          ? <Login onDone={refresh} initialError={error} />
          : <ProjectList projects={projects} error={listError} onOpen={(project) => setLoc({ kind: "project", project })} onReload={loadProjects} />)}
        {loc?.kind === "project" && (
          <ProjectScreen key={loc.project.full_name} project={loc.project} path={loc.path}
            onPathChange={(path) => setLoc((l) => (l?.kind === "project" ? { ...l, path } : l))}
            onChanged={(p) => { setLoc({ kind: "project", project: p }); setProjects((l) => l?.map((x) => (x.full_name === p.full_name ? p : x)) ?? null); }} />
        )}
        {!loc && <main className="center muted">読み込み中…</main>}
      </section>
    </div>
  );
}
