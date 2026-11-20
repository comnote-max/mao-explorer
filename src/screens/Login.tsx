import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { T } from "../terms";
import { t , tErr } from "../i18n";

type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};
type Poll =
  | { state: "pending" }
  | { state: "slow_down"; interval: number }
  | { state: "expired" }
  | { state: "denied" }
  | { state: "success" };

export default function Login({ onDone, initialError }: { onDone: () => void; initialError: string | null }) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const poll = (dc: DeviceCode, interval: number) => {
    timer.current = window.setTimeout(async () => {
      try {
        const r = await invoke<Poll>("login_poll", { deviceCode: dc.device_code, interval });
        if (r.state === "success") return onDone();
        if (r.state === "pending") return poll(dc, interval);
        if (r.state === "slow_down") return poll(dc, r.interval);
        setCode(null);
        setError(r.state === "expired" ? t("コードの有効期限が切れました。もう一度お試しください。") : t("接続が拒否されました。"));
      } catch (e) {
        setCode(null);
        setError(tErr(e));
      }
    }, interval * 1000);
  };

  const starting = useRef(false);
  const start = async () => {
    if (starting.current) return; // 連打しても1回だけ
    starting.current = true;
    window.clearTimeout(timer.current);
    setError(null);
    try {
      const dc = await invoke<DeviceCode>("login_start");
      setCode(dc);
      await navigator.clipboard.writeText(dc.user_code).catch(() => {});
      await openUrl(dc.verification_uri);
      poll(dc, dc.interval);
    } catch (e) {
      setError(tErr(e));
    } finally {
      starting.current = false;
    }
  };

  return (
    <main className="center">
      <h1>🐙 GitHub</h1>
      {!code && <>
        <p className="login-lead">{t("ここは GitHub というクラウドに置いた、みんなで使うフォルダです。")}<br />{t("使うには GitHub のアカウントで接続してください。")}</p>
      </>}
      {code ? (
        <>
          <p>{t("ブラウザで次のコードを入力してください（コピー済み）")}</p>
          <div className="code">{code.user_code}</div>
          <p className="muted">{t("入力が終わると自動で接続されます…")}</p>
        </>
      ) : (
        <div className="login-actions">
          <button className="primary big" onClick={start}>{T.login}</button>
          <p className="muted">{t("アカウントをお持ちでない方")}　<button className="link-btn" onClick={() => openUrl("https://github.com/signup")}>{t("無料で新規登録")}</button></p>
          <p className="muted small-text">{t("登録が終わったら、上の「{0}」を押してください。", [T.login])}</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
