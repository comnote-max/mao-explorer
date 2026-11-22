/**
 * 開発用：普通のブラウザで `?bridge` を付けて開くと、本物のアプリ（MAO_BRIDGE=1 で起動したデバッグ版）の
 * コマンドを 127.0.0.1:1430 経由で呼ぶ。本物の Git・GitHub を使うので、テスト用リポジトリで使うこと。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const enabled = !("__TAURI_INTERNALS__" in window) && new URLSearchParams(location.search).has("bridge");

if (enabled) {
  const call = async (cmd: string, args: any) => {
    const r = await fetch(`http://127.0.0.1:1430/invoke/${cmd}`, {
      method: "POST", headers: { "content-type": "application/json", "x-mao-bridge": "1" }, body: JSON.stringify(args ?? {}),
    });
    const j = await r.json();
    if ("err" in j) throw j.err;
    return j.ok;
  };
  const toast = (title: string, msg: string) => {
    const d = document.createElement("div");
    d.setAttribute("role", "alert");
    d.setAttribute("style", "position:fixed;left:50%;top:20px;transform:translateX(-50%);max-width:560px;background:#ffd;border:2px solid #aa8;z-index:99999;padding:10px 14px;white-space:pre-wrap;font:14px sans-serif;box-shadow:0 6px 20px #0004");
    d.textContent = `${title}\n${msg}`;
    const b = document.createElement("button"); b.textContent = "閉じる"; b.style.marginTop = "8px"; b.onclick = () => d.remove(); d.appendChild(document.createElement("br")); d.appendChild(b);
    document.body.appendChild(d);
  };
  // 自動操作を止めないよう、ダイアログは画面内の表示に置き換える（確認は OK 扱い）
  window.alert = (m?: any) => toast("【お知らせ】", String(m ?? ""));
  window.confirm = (m?: any) => { toast("【テスト環境：確認ダイアログは自動で OK になります】", String(m ?? "")); return true; };
  window.prompt = (m?: any, def?: string) => { toast("【テスト環境：入力ダイアログは既定値のまま進みます】", String(m ?? "")); return def ?? ""; };

  /** 「開く」の代わり：テキストはページ内の簡易エディタで編集する（メモ帳の代わり） */
  const openFile = async (path: string) => {
    const text = await call("fs_read_text", { path }).catch(() => null);
    if (text === null) { toast("【お知らせ】", "このファイルはテスト環境では開けません（文字のファイルだけ開けます）"); return; }
    await new Promise<void>((done) => {
      const box = document.createElement("div");
      box.setAttribute("style", "position:fixed;inset:10% 20%;background:#fff;border:2px solid #555;z-index:99999;display:flex;flex-direction:column;padding:8px;gap:6px;font:14px sans-serif;box-shadow:0 8px 30px #0006");
      box.innerHTML = `<div>📝 メモ帳 — ${path.split(/[\\/]/).pop()}</div><textarea aria-label="メモ帳の本文" style="flex:1;font:14px monospace"></textarea><div style="display:flex;gap:6px;justify-content:flex-end"><button data-k="cancel">保存しないで閉じる</button><button data-k="save">上書き保存して閉じる</button></div>`;
      const ta = box.querySelector("textarea")!; ta.value = text;
      box.addEventListener("click", async (e) => {
        const k = (e.target as HTMLElement).dataset.k; if (!k) return;
        if (k === "save") await call("fs_write_text", { path, text: text.includes("\r\n") ? ta.value.replace(/\r?\n/g, "\r\n") : ta.value }).catch((er) => toast("【保存失敗】", String(er)));
        box.remove(); done();
      });
      document.body.appendChild(box); ta.focus();
    });
  };

  let cb = 0;
  (window as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback: () => ++cb,
    convertFileSrc: () => "data:,",
    invoke: async (cmd: string, args: any) => {
      if (cmd === "plugin:event|listen") return 1;
      if (cmd === "plugin:event|unlisten") return null;
      if (cmd === "plugin:opener|open_url") { window.open(args?.url, "_blank"); return null; }
      if (cmd === "fs_open") return openFile(args.path);
      return call(cmd, args);
    },
  };
  console.info("[bridge] 本物のバックエンドにつないで起動しました");
}
export {};
