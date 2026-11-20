import { ReactNode, useEffect, useRef, useState } from "react";
import { applySettings, classic, lang, LANGS, t } from "../i18n";
import { Ic, iconStyle, setIconStyle } from "../icons";

type IcName = Parameters<typeof Ic>[0]["name"];
export type MenuItem = { icon: IcName; label: string; onClick: () => void; disabled?: boolean; checked?: boolean } | "sep";

/** ボタンを押すと下に開くメニュー（外をクリックすると閉じる） */
function Drop({ button, title, children, alignRight }: { button: ReactNode; title: string; children: (close: () => void) => ReactNode; alignRight?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const c = () => setOpen(false);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("click", c); window.addEventListener("keydown", k); window.addEventListener("mao:close-menus", c);
    return () => { window.removeEventListener("click", c); window.removeEventListener("keydown", k); window.removeEventListener("mao:close-menus", c); };
  }, [open]);
  // 置かれた場所に合わせて、右寄せ・左寄せを選ぶ（ペインの外にはみ出すと切れて見えないため）
  const btn = useRef<HTMLButtonElement>(null);
  const [right, setRight] = useState(!!alignRight);
  const decide = () => {
    const b = btn.current?.getBoundingClientRect();
    const pane = (btn.current?.closest(".pane") ?? document.body).getBoundingClientRect();
    if (b) setRight(b.right - pane.left > pane.width / 2);
  };
  return (
    <div className="dropdown">
      <button ref={btn} className={"icon" + (open ? " on" : "")} title={title} onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new Event("mao:close-menus")); decide(); setOpen(!open); }}>{button}</button>
      {open && (
        <div className="menu tool-menu" style={{ top: "100%", ...(right ? { right: 0 } : { left: 0 }) }} onClick={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const Items = ({ items, close }: { items: MenuItem[]; close: () => void }) => (
  <>{items.map((it, i) => it === "sep" ? <hr key={i} /> : (
    <div key={i} className={it.disabled ? "disabled" : ""} onClick={() => { close(); it.onClick(); }}>
      <span className="mi-check">{it.checked ? "✔" : ""}</span><Ic name={it.icon} /> {it.label}
    </div>
  ))}</>
);

export type View = "details" | "medium" | "large";

/** 「表示」メニュー：表示方法・プレビュー・隠しファイル・アイコンの見た目 */
export function ViewMenu({ view, onView, preview, onPreview, hidden, onHidden }: {
  view: View; onView: (v: View) => void; preview: boolean; onPreview: () => void; hidden?: boolean; onHidden?: (v: boolean) => void;
}) {
  const items: MenuItem[] = [
    { icon: "large", label: t("大アイコン"), checked: view === "large", onClick: () => onView("large") },
    { icon: "medium", label: t("中アイコン"), checked: view === "medium", onClick: () => onView("medium") },
    { icon: "details", label: t("詳細"), checked: view === "details", onClick: () => onView("details") },
    "sep",
    { icon: "preview", label: t("プレビュー ウィンドウ（Alt+P）"), checked: preview, onClick: onPreview },
    ...(onHidden ? [{ icon: "hidden", label: t("隠しファイル"), checked: !!hidden, onClick: () => onHidden(!hidden) } as MenuItem] : []),
    "sep",
    { icon: "icons", label: t("モダン（はじめての人向け：下書き・同期・反映など）", undefined, true), checked: !classic, onClick: () => classic && applySettings(lang, false) },
    { icon: "icons", label: t("クラシック（Git 経験者向け：branch・commit・push・merge）", undefined, true), checked: classic, onClick: () => !classic && applySettings(lang, true) },
    "sep",
    { icon: "icons", label: t("アイコン：シンプル（線）"), checked: iconStyle === "modern", onClick: () => iconStyle !== "modern" && setIconStyle("modern") },
    { icon: "icons", label: t("アイコン：カラフル（絵文字）"), checked: iconStyle === "classic", onClick: () => iconStyle !== "classic" && setIconStyle("classic") },
  ];
  return <Drop title={t("表示")} alignRight button={<><Ic name="view" /> {t("表示")} ▾</>}>{(close) => <Items items={items} close={close} />}</Drop>;
}

/** 「…」メニュー：画面ごとの操作＋言語・設定 */
export function MoreMenu({ items = [] }: { items?: MenuItem[] }) {
  const all: MenuItem[] = [
    ...items, ...(items.length ? ["sep" as const] : []),
    ...LANGS.map((l): MenuItem => ({ icon: "lang", label: `Language：${l.name}`, checked: l.code === lang, onClick: () => l.code !== lang && applySettings(l.code, classic) })),
    "sep",
    { icon: "settings", label: t("オプション（設定）"), onClick: () => window.dispatchEvent(new Event("mao:open-settings")) },
  ];
  return <Drop title={t("もっと見る")} alignRight button={<Ic name="more" />}>{(close) => <Items items={all} close={close} />}</Drop>;
}
