import { classic, t } from "./i18n";
/** 仮想フォルダの「下書き01」番号。一度付けた番号は変えない（片付けても他の番号はずれない）。 */
const key = (fullName: string) => `mao.copyNo.${fullName}`;

export function copyNumbers(fullName: string, names: string[]): Record<string, number> {
  let map: Record<string, number> = {};
  try { map = JSON.parse(localStorage.getItem(key(fullName)) ?? "{}"); } catch { /* 読めなければ振り直す */ }
  // 片付けた下書きの番号は忘れる（1つ目なのに「02」にならないように）。今ある下書きの番号は変えない
  let changed = false;
  if (names.length) for (const k of Object.keys(map)) if (!names.includes(k)) { delete map[k]; changed = true; }
  const used = new Set(Object.values(map));
  let next = 1;
  for (const n of names) if (!(n in map)) { while (used.has(next)) next++; map[n] = next; used.add(next); changed = true; }
  if (changed) try { localStorage.setItem(key(fullName), JSON.stringify(map)); } catch { /* 表示だけなので無視 */ }
  return map;
}

/** クラシックでは番号ではなく branch 名そのものを使う */
export const copyText = (n: number, name?: string) => classic && name ? name : t("下書き{0}", [String(n).padStart(2, "0")]);

/** 黄色い楕円の「下書き01」タグ（クラシックでは branch 名が横に出るので出さない） */
export const CopyTag = ({ n }: { n: number }) => classic ? null : <span className="copytag">{copyText(n)}</span>;
