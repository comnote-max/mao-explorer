import { ReactNode } from "react";
import { classic } from "./i18n";

/*
 * アイコンの見た目：クラシック（絵文字）／モダン（Windows 11 風の線のアイコン）。
 * 切り替えは「表示」メニューから。画面を読み込み直して反映する。
 */
export type IconStyle = "classic" | "modern";
const KEY = "mao.iconStyle";
/** アイコンの見た目（モード＝用語とは別に選べる）。classic＝絵文字、modern＝線のアイコン */
export const iconStyle: IconStyle = (() => { try { const v = localStorage.getItem(KEY); if (v === "classic" || v === "modern") return v; } catch { /* 既定 */ } return classic ? "classic" : "modern"; })();
export const setIconStyle = (v: IconStyle) => { try { localStorage.setItem(KEY, v); } catch { /* 今回だけ */ } window.location.reload(); };

const P: Record<string, ReactNode> = {
  cut: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  paste: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>,
  rename: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  delete: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  new: <><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></>,
  preview: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  details: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  medium: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  large: <rect x="3" y="3" width="18" height="18" rx="2" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  view: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  lang: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" /></>,
  path: <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />,
  selectAll: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m9 12 2 2 4-4" /></>,
  selectNone: <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />,
  invert: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 21 21 3" /></>,
  hidden: <><path d="M2 12s3-7 10-7c2 0 3.7.6 5 1.4M22 12s-3 7-10 7c-2 0-3.7-.6-5-1.4" /><path d="M3 3l18 18" /></>,
  icons: <><circle cx="8" cy="8" r="3" /><rect x="13" y="13" width="7" height="7" rx="1" /></>,
};

const EMOJI: Record<string, string> = {
  cut: "✂", copy: "⧉", paste: "📋", rename: "✏", delete: "🗑", new: "⊕", preview: "👁", details: "☰", medium: "▦", large: "⬜",
  more: "⋯", view: "▤", settings: "⚙", lang: "🌐", path: "🔗", selectAll: "☑", selectNone: "☐", invert: "◩", hidden: "👻", icons: "🎨",
};

/** 操作ボタン用のアイコン */
export function Ic({ name }: { name: keyof typeof P & string }) {
  if (iconStyle === "classic") return <span className="ic">{EMOJI[name] ?? ""}</span>;
  return (
    <svg className="ic svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{P[name]}</svg>
  );
}

const TYPE_COLOR: [string[], string][] = [
  [["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"], "#0ea5e9"],
  [["mp4", "mov", "avi", "mkv"], "#a855f7"],
  [["mp3", "wav", "flac", "m4a"], "#ec4899"],
  [["zip", "7z", "rar"], "#a16207"],
  [["pdf"], "#dc2626"],
  [["doc", "docx"], "#2563eb"],
  [["xls", "xlsx", "csv"], "#16a34a"],
  [["ppt", "pptx"], "#ea580c"],
  [["exe", "msi", "bat", "cmd", "ps1"], "#475569"],
];

/** ファイル・フォルダのアイコン（クラシックは絵文字） */
export function FileIcon({ name, dir, emoji }: { name: string; dir: boolean; emoji: string }) {
  if (iconStyle === "classic") return <>{emoji}</>;
  if (dir) return (
    <svg className="fic" viewBox="0 0 24 24"><path fill="#f5c542" stroke="#d4a017" strokeWidth="1" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
  );
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const c = TYPE_COLOR.find(([l]) => l.includes(ext))?.[1] ?? "#94a3b8";
  return (
    <svg className="fic" viewBox="0 0 24 24" fill="none" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" fill="#fff" stroke="#94a3b8" strokeWidth="1.2" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" stroke="#94a3b8" strokeWidth="1.2" />
      <rect x="7" y="13" width="10" height="5" rx="1" fill={c} />
    </svg>
  );
}
