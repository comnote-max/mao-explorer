import { fsApi } from "./api";
import { t, tErr } from "./i18n";

/*
 * アプリ内のドラッグ＆ドロップ。
 * Windows の Tauri では、OS からのファイル受け取りを有効にしていると HTML5 のドラッグが使えないため、
 * マウスの動きで自前で行う。落とせる場所には data-drop（フォルダのパス）を付けておく。
 */

/** ファイル操作が終わったことを開いている画面に知らせる（一覧を読み直してもらう） */
export const notifyChanged = () => window.dispatchEvent(new Event("mao:fs-changed"));

/** 落とした先にコピー（Shift を押しながらなら移動） */
export async function dropInto(dest: string, paths: string[], move: boolean) {
  const sepRe = /[\\/]$/;
  const d = dest.replace(sepRe, "");
  const list = paths.filter((p) => p !== d && !d.startsWith(p + "\\") && !d.startsWith(p + "/") && p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"))) !== d);
  if (!list.length) return;
  try { await (move ? fsApi.move(list, dest) : fsApi.copy(list, dest)); }
  catch (e) { window.alert(tErr(e)); }
  notifyChanged();
}

const targetAt = (x: number, y: number) =>
  (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]") ?? null;

/** OS からのドロップ位置（物理ピクセル）にある「落とせる場所」を探す */
export function dropTargetAt(x: number, y: number): string | null {
  const r = window.devicePixelRatio || 1;
  return targetAt(x / r, y / r)?.dataset.drop ?? null;
}

/** フォルダを「落とせる場所」にする */
export const dropProps = (path: string) => ({ "data-drop": path });

/** ファイル・フォルダを掴めるようにする（選択中のものをまとめて運ぶ） */
export const dragProps = (paths: () => string[], label: () => string) => ({
  onMouseDown: (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let ghost: HTMLDivElement | null = null;
    let over: HTMLElement | null = null;
    let carried: string[] = [];
    const setOver = (el: HTMLElement | null) => {
      if (el === over) return;
      over?.classList.remove("drop-over");
      over = el && !carried.includes(el.dataset.drop!) ? el : null;
      over?.classList.add("drop-over");
    };
    const move = (ev: MouseEvent) => {
      if (!ghost) {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
        carried = paths();
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        document.body.appendChild(ghost);
        document.body.classList.add("dragging-files");
      }
      ghost.textContent = `${label()}　${ev.shiftKey ? t("→ 移動") : t("→ コピー（Shift で移動）")}`;
      ghost.style.left = ev.clientX + 14 + "px";
      ghost.style.top = ev.clientY + 10 + "px";
      setOver(targetAt(ev.clientX, ev.clientY));
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up, true);
      if (!ghost) return;
      ghost.remove();
      document.body.classList.remove("dragging-files");
      const dest = over?.dataset.drop;
      setOver(null);
      // ドラッグの後に「クリック」が起きて選択が変わらないようにする
      const stop = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
      if (dest) dropInto(dest, carried, ev.shiftKey);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, true);
  },
});
