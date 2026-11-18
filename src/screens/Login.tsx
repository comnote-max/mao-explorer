import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { T } from "../terms";

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
        setError(r.state === "expired" ? "コードの有効期限が切れました。もう一度お試しください。" : "接続が拒否されました。");
      } catch (e) {
        setCode(null);
        setError(String(e));
      }
    }, interval * 1000);
  };

  const start = async () => {
    setError(null);
    try {
      const dc = await invoke<DeviceCode>("login_start");
      setCode(dc);
      await navigator.clipboard.writeText(dc.user_code).catch(() => {});
      await openUrl(dc.verification_uri);
      poll(dc, dc.interval);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <main className="center">
      <h1>MAO Explorer</h1>
      {code ? (
        <>
          <p>ブラウザで次のコードを入力してください（コピー済み）</p>
          <div className="code">{code.user_code}</div>
          <p className="muted">入力が終わると自動で接続されます…</p>
        </>
      ) : (
        <button className="primary" onClick={start}>{T.login}</button>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
