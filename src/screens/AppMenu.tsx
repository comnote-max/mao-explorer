import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { lang, t } from "../i18n";
import appIcon from "../../src-tauri/icons/64x64.png";

/** maociva 共通の ☰ メニュー（ログインなし版）。項目と順番は maociva アプリ共通仕様 3.1 に合わせる。 */
const SITE = "https://maociva.com";
const SEEN_KEY = "maociva.library.seenAt";
const open = (path: string) => openUrl(`${SITE}${path}${path.includes("?") ? "&" : "?"}lang=${lang}`).catch(() => {});

export default function AppMenu({ onSettings }: { onSettings: () => void }) {
  const [show, setShow] = useState(false);
  const [fresh, setFresh] = useState(false); // ライブラリに新着アプリがある
  const box = useRef<HTMLDivElement>(null);

  // 新着：公開から 30 日以内で、最後にライブラリを開いた後に公開されたもの
  useEffect(() => {
    fetch(`${SITE}/library/apps.json`).then((r) => r.json()).then((j) => {
      const apps: { releasedAt?: string }[] = Array.isArray(j) ? j : j.apps ?? [];
      let seen = 0; try { seen = Number(localStorage.getItem(SEEN_KEY) ?? 0); } catch { /* 初回扱い */ }
      const now = Date.now();
      setFresh(apps.some((a) => { const at = a.releasedAt ? Date.parse(a.releasedAt) : NaN; return at > seen && now - at < 30 * 86400_000; }));
    }).catch(() => { /* 取れなくても困らない */ });
  }, []);
  useEffect(() => {
    if (!show) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setShow(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [show]);

  const library = () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* 任意 */ } setFresh(false); open("/library/"); setShow(false); };
  const go = (path: string) => { open(path); setShow(false); };

  return (
    <div className="app-menu" ref={box}>
      <button className="icon app-menu-btn" title={t("メニュー")} onClick={() => setShow(!show)}>☰{fresh && <span className="dot" />}</button>
      {show && (
        <div className="menu app-menu-list">
          <div className="app-menu-head">
            <img src={appIcon} alt="" width={28} height={28} />
            <div><b>MAO Explorer</b><div className="muted small-text">by maociva</div></div>
          </div>
          <div onClick={() => { setShow(false); onSettings(); }}>{t("設定")}</div>
          <div onClick={library}>{t("maociva アプリライブラリ")}{fresh && <span className="dot" />}</div>
          <div onClick={() => go("/")}>{t("maociva について")}</div>
          <div onClick={() => go("/support/")}>{t("サポート")}</div>
          <div onClick={() => go("/privacy/")}>{t("プライバシーポリシー")}</div>
          <div onClick={() => go("/terms/")}>{t("利用規約")}</div>
          <div className="app-menu-promo" onClick={library}>
            <b>{t("maociva のほかのアプリも見てみませんか？")}</b>
            <div className="small-text">{t("毎日の仕事や暮らしを、ちょっと楽にするアプリを作っています。")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
