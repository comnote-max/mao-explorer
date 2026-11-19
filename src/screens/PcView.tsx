import { Place } from "../api";
import { t, tPlace } from "../i18n";

const GROUPS: { kind: Place["kind"]; title: string; icon: string }[] = [
  { kind: "quick", title: t("よく使うフォルダー"), icon: "📁" },
  { kind: "drive", title: t("ドライブ"), icon: "💽" },
  { kind: "nas", title: t("NAS（ネットワーク）"), icon: "🗄" },
  { kind: "onedrive", title: "OneDrive", icon: "☁" },
  { kind: "gdrive", title: "Google Drive", icon: "☁" },
];

/** 「PC」を開いたときの画面（Windows の「PC」と同じく、場所をアイコンで並べる）。 */
export default function PcView({ places, nas, onOpen }: { places: Place[]; nas: string[]; onOpen: (path: string) => void }) {
  const all = [...places, ...nas.map((path) => ({ name: path, path, kind: "nas" as const }))];
  return (
    <>
      <div className="navbar"><div className="address">💻 PC</div></div>
      <div className="files-scroll pc-view">
        {GROUPS.map((g) => {
          const items = all.filter((p) => p.kind === g.kind);
          if (!items.length) return null;
          return (
            <section key={g.kind}>
              <h4 className="pc-group">{g.title}（{items.length}）</h4>
              <div className="tiles large">
                {items.map((p) => (
                  <div key={p.path} className="tile" title={p.path} onDoubleClick={() => onOpen(p.path)} onClick={() => onOpen(p.path)}>
                    <div className="tile-icon">{g.icon}</div>
                    <div className="tile-name">{tPlace(p.name)}</div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="statusbar">{t("{0} 個の場所", [all.length])}</div>
    </>
  );
}
