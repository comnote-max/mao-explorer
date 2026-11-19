import { t } from "./i18n";
/** 仮想フォルダの「下書き01」番号。一度付けた番号は変えない（片付けても他の番号はずれない）。 */
const key = (fullName: string) => `mao.copyNo.${fullName}`;

export function copyNumbers(fullName: string, names: string[]): Record<string, number> {
  let map: Record<string, number> = {};
  try { map = JSON.parse(localStorage.getItem(key(fullName)) ?? "{}"); } catch { /* 読めなければ振り直す */ }
  let next = Math.max(0, ...Object.values(map)) + 1;
  let changed = false;
  for (const n of names) if (!(n in map)) { map[n] = next++; changed = true; }
  if (changed) try { localStorage.setItem(key(fullName), JSON.stringify(map)); } catch { /* 表示だけなので無視 */ }
  return map;
}

export const copyText = (n: number) => t("下書き{0}", [String(n).padStart(2, "0")]);

/** 黄色い楕円の「下書き01」タグ */
export const CopyTag = ({ n }: { n: number }) => <span className="copytag">{copyText(n)}</span>;
