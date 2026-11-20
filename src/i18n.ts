// 多言語対応。原文（日本語）をそのままキーにする方式。
// 訳がない言葉は日本語のまま表示されるので、言語を足すときは locales/<code>.json を作って LANGS に足すだけ。
// 文中の {0} {1} … は差し込む値（人名・件数など）。訳文でも同じ番号を使う。
import en from "./locales/en.json";
import classicWords from "./locales/classic.json";

export const LANGS = [
  { code: "ja", name: "日本語", locale: "ja-JP" },
  { code: "en", name: "English", locale: "en-US" },
] as const;
export type Lang = (typeof LANGS)[number]["code"];

const DICTS: Partial<Record<Lang, Record<string, string>>> = { en };

const KEY = "mao.lang";
const detect = (): Lang => {
  try {
    const s = localStorage.getItem(KEY);
    if (s && LANGS.some((l) => l.code === s)) return s as Lang;
  } catch { /* 読めなければ OS の言語 */ }
  const nav = (navigator.language || "en").toLowerCase();
  return (LANGS.find((l) => nav.startsWith(l.code))?.code ?? "en") as Lang;
};

export const lang: Lang = detect();
/** 日付・数値の表示に使うロケール */
export const LOCALE: string = LANGS.find((l) => l.code === lang)!.locale;
document.documentElement.lang = lang;

/** クラシックモード：「下書き」→「ブランチ」のように Git の正式な用語で表示する */
const CLASSIC_KEY = "mao.classic";
export const classic: boolean = (() => { try { return localStorage.getItem(CLASSIC_KEY) === "1"; } catch { return false; } })();
const WORDS: [string, string][] = classic ? ((classicWords as unknown as Record<string, [string, string][]>)[lang] ?? []) : [];
const toClassic = (s: string) => WORDS.reduce((r, [a, b]) => r.split(a).join(b), s);
/** クラシック専用の文言（置き換えだと文が崩れるものは丸ごと書き直す。キーは日本語の原文） */
const PHRASES: Record<string, string> = classic ? ((classicWords as unknown as { phrases?: Record<string, Record<string, string>> }).phrases?.[lang] ?? {}) : {};

export function t(s: string, p?: unknown[], raw = false): string {
  let r = DICTS[lang]?.[s] || s;
  if (classic && !raw) r = PHRASES[s] ?? toClassic(r);
  return p ? r.replace(/\{(\d+)\}/g, (m, i) => (p[+i] ?? "") + "") : r;
}

/** 言語を変える（画面の文言をすべて切り替えるため再読み込みする） */
export function applySettings(code: Lang, classicMode: boolean) {
  try { localStorage.setItem(KEY, code); localStorage.setItem(CLASSIC_KEY, classicMode ? "1" : "0"); } catch { /* 保存できなくても今回は切り替える */ }
  window.location.reload();
}

/** 場所の名前（「ドライブ (C:)」など、Rust 側が付けた名前）を訳す */
export function tPlace(name: string): string {
  const m = /^(.*) \(([A-Za-z]):\)$/.exec(name);
  return m ? `${t(m[1])} (${m[2]}:)` : t(name);
}

/** Rust 側から届くメッセージの型（{0} などは Rust が差し込む値）。ここに足すと tErr で訳せる */
const ERROR_KEYS: string[] = [
  "GitHubのクライアントIDが設定されていません（MAO_GITHUB_CLIENT_ID）",
  "通信に失敗しました: {0}",
  "資格情報の保存に失敗しました: {0}",
  "GitHubからの応答が不正です: {0}",
  "ごみ箱へ移動できませんでした: {0}",
  "ファイル名に次の文字は使えません: {0}",
  "同じ名前の項目がすでにあります",
  "フォルダをその中にはコピーできません",
  "フォルダをその中には移動できません",
  "GitHubに接続していません",
  "GitHubが拒否しました（{0}）: {1}",
  "読み込めません",
  "承認待ちです（責任者の承認が必要な設定です）",
  "確認処理中です（自動チェックの完了待ち）",
  "本体と内容がぶつかっています（要対応）",
  "本体に反映する権限がありません",
  "現在は本体に反映できません",
  "{0}。GitHubの応答: {1}",
  "閲覧のみの権限です",
  "管理者として本体に反映できます",
  "本体は保護されていません",
  "本体は保護されています。責任者への依頼が必要です",
  "Gitの処理に失敗しました: {0}",
  "ファイル操作に失敗しました: {0}",
  "GitHubへの送信が拒否されました（{0}）。本体へ直接書き込めない設定の可能性があります。",
  "保存先が空ではありません: {0}",
  "このプロジェクトはまだ同期されていません",
  "この名前は使えません",
  "同じ名前のフォルダがすでにあります",
  "仮想フォルダの作成後に見つかりません",
  "本体は削除できません",
  "フォルダをごみ箱へ移せませんでした：{0}",
  "履歴保存のメッセージを入力してください",
  "履歴保存する変更がありません",
  "ごみ箱へ移せませんでした：{0}",
  "履歴未保存の変更があります。先に履歴保存するか、元に戻してください。",
  "すでにこの時点と同じ状態です"
];
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ERROR_PATTERNS = ERROR_KEYS.filter((k) => /\{\d+\}/.test(k)).map((k) => ({
  k,
  idx: [...k.matchAll(/\{(\d+)\}/g)].map((m) => +m[1]),
  re: new RegExp("^" + k.split(/\{\d+\}/).map(escRe).join("([\\s\\S]*?)") + "$"),
}));

/** エラーなど、Rust 側から届いた文を訳す（知らない文はそのまま） */
export function tErr(e: unknown): string {
  const s = String(e).replace(/^Error:\s*/, "");
  // 別のアプリ（Git ツール・エディタなど）が同じフォルダの Git を使っている最中
  if (/code=Locked/.test(s)) return t("ほかのアプリ（Git ツールなど）がこのフォルダを使っているため、今は同期できません。少し待ってからもう一度お試しください。");
  if (/is still a draft/.test(s)) return t("この依頼は依頼者がまだ「作成中」にしているため、反映できません。依頼者が GitHub で「Ready for review」にすると反映できます。");
  if (ERROR_KEYS.includes(s)) return t(s);
  for (const p of ERROR_PATTERNS) {
    const m = p.re.exec(s);
    if (!m) continue;
    const params: string[] = [];
    p.idx.forEach((n, i) => { params[n] = tErr(m[i + 1]); });
    return t(p.k, params);
  }
  return classic ? t(s) : s;
}
