import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Login from "./screens/Login";
import ProjectList from "./screens/ProjectList";
import ProjectScreen from "./screens/ProjectScreen";
import FileBrowser from "./screens/FileBrowser";
import PcView from "./screens/PcView";
import Settings from "./screens/Settings";
import { ProjectNode, TreeNode } from "./screens/FolderTree";
import { api, baseName, dispName, fsApi, Place, Project } from "./api";
import { T } from "./terms";
import { t, tPlace , tErr } from "./i18n";

export type Account = { login: string; name: string | null; avatar_url: string };

type Loc = { kind: "fs"; path: string } | { kind: "github" } | { kind: "pc" } | { kind: "project"; project: Project; path?: string };

export default function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  // タブ：それぞれが1つの場所を表示する
  const [tabs, setTabs] = useState<{ id: number; loc: Loc; back?: Loc[] }[]>([]);
  const [active, setActive] = useState(0);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  const loc: Loc | null = tab?.loc ?? null;
  const setLoc = (v: Loc | ((l: Loc | null) => Loc | null)) =>
    setTabs((ts) => {
      if (!ts.length) { const l = typeof v === "function" ? v(null) : v; if (!l) return ts; setActive(1); return [{ id: 1, loc: l }]; }
      const cur = ts.find((t) => t.id === active) ?? ts[0];
      return ts.map((t) => (t.id === cur.id ? { ...t, loc: (typeof v === "function" ? v(t.loc) : v) ?? t.loc } : t));
    });
  // 別の場所へ移動（今の場所を「戻る」用に覚えておく）
  const go = (l: Loc) => setTabs((ts) => ts.map((t) => (t.id === (tab?.id ?? -1) ? { ...t, back: [...(t.back ?? []), t.loc].slice(-50), loc: l } : t)));
  const canBack = !!tab?.back?.length;
  const goBack = () => setTabs((ts) => ts.map((t) => (t.id === tab?.id && t.back?.length ? { ...t, loc: t.back[t.back.length - 1], back: t.back.slice(0, -1) } : t)));
  const homeLoc = (): Loc => ({ kind: "github" });
  const newTab = (l: Loc = loc ?? homeLoc()) => {
    const id = Math.max(0, ...tabs.map((t) => t.id)) + 1;
    setTabs([...tabs, { id, loc: l }]);
    setActive(id);
  };
  const closeTab = (id: number) => {
    if (tabs.length === 1) return;
    const i = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (id === tab?.id) setActive(rest[Math.max(0, i - 1)].id);
  };
  const tabLabel = (l: Loc) =>
    l.kind === "github" ? `🐙 ${T.cloud}`
    : l.kind === "project" ? `📁 ${dispName(l.project)}${l.path && baseName(l.path) !== T.mainBranch ? ` › ${baseName(l.path)}` : ""}`
    : l.kind === "pc" ? "💻 PC"
    : `📁 ${baseName(l.path) || l.path}`;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key === "t") { e.preventDefault(); newTab(); }
      if (e.key === "w" && tab) { e.preventDefault(); closeTab(tab.id); }
      if (e.key === "Tab" && tabs.length > 1) {
        e.preventDefault();
        const i = tabs.findIndex((t) => t.id === tab?.id);
        setActive(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const [settings, setSettings] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ pc: true, github: false, nas: true, onedrive: true, gdrive: true });
  const fsCur = loc?.kind === "fs" ? loc.path : null;
  const goFs = (path: string) => go({ kind: "fs", path });
  const [nas, setNas] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("mao.nas") ?? "[]"); } catch { return []; } });
  const saveNas = (l: string[]) => { setNas(l); try { localStorage.setItem("mao.nas", JSON.stringify(l)); } catch {} };
  const addNas = async () => {
    const a = window.prompt(t("NAS のアドレスを入力してください（例：{0} または {1}）", [String.raw`\\NAS\共有`, String.raw`\\192.168.1.10\share`]));
    const path = a?.trim().replace(/\//g, "\\").replace(/\\+$/, "");
    if (!path) return;
    try { await fsApi.list(path, false); } catch (e) { window.alert(t("開けませんでした：{0}\n\nWindows のエクスプローラーで一度そのアドレスを開いてパスワードを保存すると、開けるようになります。", [tErr(e)])); return; }
    if (!nas.includes(path)) saveNas([...nas, path]);
    goFs(path);
  };

  const refresh = () =>
    invoke<Account | null>("auth_account")
      .then(setAccount)
      .catch((e) => { setError(tErr(e)); setAccount(null); });

  const loadProjects = () => {
    setListError(null);
    api.projects().then(setProjects).catch((e) => setListError(tErr(e)));
  };

  useEffect(() => {
    refresh();
    fsApi.places().then((ps) => {
      setPlaces(ps);
      setLoc((l) => l ?? { kind: "github" });
    });
  }, []);
  useEffect(() => { if (account) loadProjects(); }, [account]);

  // GitHub のフォルダを開いているときは、ツリーの GitHub も開いておく
  const inProject = loc?.kind === "project" || loc?.kind === "github";
  useEffect(() => { if (inProject) setOpen((o) => (o.github ? o : { ...o, github: true })); }, [inProject]);
  const isProject = (fn: string) => loc?.kind === "project" && loc.project.full_name === fn;

  return (
    <div className="shell">
      <aside className="tree">
        <div className={"tree-item" + (loc?.kind === "github" ? " active" : "")} onClick={() => { go({ kind: "github" }); setOpen({ ...open, github: true }); }}>
          <span onClick={(e) => { e.stopPropagation(); setOpen({ ...open, github: !open.github }); }}>{open.github ? "▾" : "▸"}</span> 🐙 {T.cloud}
        </div>
        {open.github && account && projects?.map((p) => (
          <ProjectNode key={p.full_name} project={p} active={isProject(p.full_name)}
            current={loc?.kind === "project" && loc.project.full_name === p.full_name ? loc.path ?? null : null}
            onSelect={(path) => (isProject(p.full_name) ? setLoc({ kind: "project", project: p, path }) : go({ kind: "project", project: p, path }))} />
        ))}
        <div className={"tree-item" + (loc?.kind === "pc" ? " active" : "")} onClick={() => { go({ kind: "pc" }); setOpen({ ...open, pc: true }); }}>
          <span className="twisty" onClick={(e) => { e.stopPropagation(); setOpen({ ...open, pc: !open.pc }); }}>{open.pc ? "▾" : "▸"}</span> 💻 PC
        </div>
        {open.pc && places.filter((pl) => pl.kind === "quick" || pl.kind === "drive").map((pl) => (
          <TreeNode key={pl.path} path={pl.path} label={tPlace(pl.name)} icon={pl.kind === "drive" ? "💽" : "⭐"} depth={1}
            current={fsCur} onSelect={goFs} />
        ))}
        {([
          ["nas", "🗄 NAS", t("Windows で「ネットワークドライブの割り当て」をすると、ここに出ます。下の＋からアドレス（{0}）でも開けます。", [String.raw`\\NAS\共有`])],
          ["onedrive", "☁ OneDrive", t("OneDrive アプリでサインインすると、ここに出ます。")],
          ["gdrive", "☁ Google Drive", t("「パソコン版 Google ドライブ」を入れてログインすると、ここに出ます。")],
        ] as const).map(([k, label, help]) => {
          const items = [...places.filter((pl) => pl.kind === k), ...(k === "nas" ? nas.map((path) => ({ name: path, path, kind: "nas" as const })) : [])];
          return (
            <div key={k}>
              <div className={"tree-item" + (items.length ? "" : " unsynced")} title={items.length ? "" : help}
                onClick={() => setOpen({ ...open, [k]: !open[k] })}>{open[k] ? "▾" : "▸"} {label}</div>
              {open[k] && items.map((pl) => (
                <TreeNode key={pl.path} path={pl.path} label={tPlace(pl.name)} icon={k === "nas" ? "🖧" : "📂"} depth={1} current={fsCur} onSelect={goFs}
                  onMenu={k === "nas" && nas.includes(pl.path) ? () => { if (window.confirm(t("「{0}」を一覧から外しますか？（中身は消えません）", [pl.path]))) saveNas(nas.filter((x) => x !== pl.path)); } : undefined} />
              ))}
              {open[k] && !items.length && <div className="tree-item muted small-help" style={{ paddingLeft: 22 }}>{help}</div>}
              {open[k] && k === "nas" && (
                <div className="tree-item muted" style={{ paddingLeft: 22 }} onClick={addNas}>{t("＋ アドレスで開く")}</div>
              )}
            </div>
          );
        })}
        <div className="tree-foot">
          {account ? (
            <>
              <img src={account.avatar_url} alt="" width={20} height={20} className="avatar" />
              <span>{account.name ?? account.login}</span>
              <button className="small" onClick={() => invoke("logout").then(() => { setAccount(null); setProjects(null); if (loc?.kind !== "fs") setLoc({ kind: "github" }); })}>{T.logout}</button>
            </>
          ) : <span className="muted">{t("GitHub 未接続")}</span>}
          <button className="icon settings-btn" title={t("設定")} onClick={() => setSettings(true)}>⚙</button>
        </div>
        {settings && <Settings onClose={() => setSettings(false)} />}
      </aside>
      <section className="pane">
        <div className="tabbar">
          {tabs.map((t) => (
            <div key={t.id} className={"tab" + (t.id === tab?.id ? " on" : "")} title={tabLabel(t.loc)}
              onClick={() => setActive(t.id)} onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}>
              <span className="tab-label">{tabLabel(t.loc)}</span>
              {tabs.length > 1 && <span className="tab-x" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>×</span>}
            </div>
          ))}
          <button className="icon" title={t("新しいタブ（Ctrl+T）")} onClick={() => newTab()}>＋</button>
        </div>
        {loc?.kind === "fs" && <FileBrowser key={tab!.id} path={loc.path} onPathChange={(path) => setLoc({ kind: "fs", path })}
          canOuterBack={canBack} outerBack={goBack} outerUp={() => go({ kind: "pc" })} />}
        {loc?.kind === "github" && (account === null
          ? <Login onDone={refresh} initialError={error} />
          : <ProjectList projects={projects} error={listError} onOpen={(project) => go({ kind: "project", project })} onReload={loadProjects} />)}
        {loc?.kind === "project" && (
          <ProjectScreen key={`${tab!.id}:${loc.project.full_name}`} project={loc.project} path={loc.path}
            canBack={canBack} onBack={goBack} onUp={() => go({ kind: "github" })}
            onPathChange={(path) => setLoc((l) => (l?.kind === "project" ? { ...l, path } : l))}
            onChanged={(p) => { setLoc({ kind: "project", project: p }); setProjects((l) => l?.map((x) => (x.full_name === p.full_name ? p : x)) ?? null); }} />
        )}
        {loc?.kind === "pc" && <PcView places={places} nas={nas} onOpen={goFs} />}
        {!loc && <main className="center muted">{t("読み込み中…")}</main>}
      </section>
    </div>
  );
}
