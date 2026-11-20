import { useEffect, useState } from "react";
import { api } from "../api";
import { tErr } from "../i18n";
import { applySettings, classic, lang, Lang, LANGS, t } from "../i18n";

/** ⚙ 設定 */
export default function Settings({ onClose }: { onClose: () => void }) {
  const [sel, setSel] = useState<Lang>(lang);
  const [cls, setCls] = useState(classic);
  const [master, setMaster] = useState("");
  const [master0, setMaster0] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.masterDir().then((d) => { setMaster(d); setMaster0(d); }); }, []);
  const saveMaster = async () => {
    try { await api.setMasterDir(master.trim()); setMaster0(master.trim()); setMsg(t("保存しました")); }
    catch (e) { setMsg(tErr(e)); }
  };
  const changed = sel !== lang || cls !== classic;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>⚙ {t("設定")}</h3>
        <label className="field">🌐 {t("言語")} / Language
          <select value={sel} onChange={(e) => setSel(e.target.value as Lang)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </label>
        <label className="field">📁 {t("PCに取り込む場所")}
          <div className="row">
            <input className="grow" value={master} onChange={(e) => { setMaster(e.target.value); setMsg(null); }} placeholder={String.raw`C:\GitHub`} />
            <button disabled={!master.trim() || master.trim() === master0} onClick={saveMaster}>{t("保存")}</button>
          </div>
        </label>
        <p className="muted small-text">{t("GitHub Desktop と同じ場所にすると、そこにあるフォルダは自動で「PCと同期中」になり、両方のアプリで同じフォルダを開けます。")}</p>
        {msg && <p className="muted small-text">{msg}</p>}
        <label className="check-row"><input type="checkbox" checked={cls} onChange={(e) => setCls(e.target.checked)} /> {t("クラシックモード（Git 経験者向け）", undefined, true)}</label>
        <p className="muted small-text">{t("下書き→branch、履歴保存→commit、同期→push / pull、反映→merge のように Git の用語そのままで表示します。オフにするとモダン（はじめての人向けのやさしい言葉）になります。", undefined, true)}</p>
        {changed && <p className="muted">{t("表示を切り替えると、画面を読み込み直します。")}</p>}
        <div className="actions">
          <button onClick={onClose}>{t("閉じる")}</button>
          <button className="primary" disabled={!changed} onClick={() => applySettings(sel, cls)}>{t("適用")}</button>
        </div>
      </div>
    </div>
  );
}
