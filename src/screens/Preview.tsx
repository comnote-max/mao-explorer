import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";
import { api, Entry, fmtSize, fmtTime, fsApi } from "../api";
import { CHANGE_LABEL } from "../terms";

const IMG = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"];
const ext = (n: string) => (n.includes(".") ? n.split(".").pop()!.toLowerCase() : "");

/** 選んだファイルの中身をその場で見る（コードは色分け・行番号付き） */
export default function Preview({ entry, count, git }: {
  entry: Entry | null; count: number; git: { root: string; rel: string; kind: string } | null;
}) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [diff, setDiff] = useState<string | null | undefined>(undefined);
  const [mode, setMode] = useState<"diff" | "content">("diff");

  useEffect(() => {
    setDiff(undefined);
    if (!git) return;
    let live = true;
    api.fileDiff(git.root, git.rel).then((d) => live && setDiff(d)).catch(() => live && setDiff(null));
    return () => { live = false; };
  }, [git?.root, git?.rel, entry?.modified]);

  useEffect(() => {
    setText(undefined);
    if (!entry || entry.is_dir || IMG.includes(ext(entry.name))) return;
    let live = true;
    fsApi.readText(entry.path).then((t) => live && setText(t)).catch(() => live && setText(null));
    return () => { live = false; };
  }, [entry?.path, entry?.modified]);

  if (!entry) return <aside className="preview-pane"><p className="muted empty">{count > 1 ? `${count} 個の項目を選択中` : "プレビューするファイルを選択してください"}</p></aside>;

  const head = (
    <div className="preview-title" title={entry.path}>
      {entry.name}
      <div className="muted small-text">{entry.is_dir ? "フォルダー" : fmtSize(entry.size)}　{fmtTime(entry.modified)}</div>
    </div>
  );

  const showDiff = !!git && mode === "diff";
  const tabs = git && (
    <div className="preview-tabs">
      <span className={`mark ${git.kind}`}>● {CHANGE_LABEL[git.kind] ?? git.kind}</span>
      <button className={"small" + (showDiff ? " on" : "")} onClick={() => setMode("diff")}>変更点</button>
      <button className={"small" + (!showDiff ? " on" : "")} onClick={() => setMode("content")}>内容</button>
    </div>
  );

  let body;
  if (showDiff) body = diff === undefined ? <p className="muted empty">読み込み中…</p>
    : diff === null ? <p className="muted empty">文字のファイルではないため、変更点を表示できません</p>
    : <Diff text={diff} />;
  else if (entry.is_dir) body = <p className="muted empty">📁 フォルダー</p>;
  else if (IMG.includes(ext(entry.name))) body = <div className="preview-img"><img src={`${convertFileSrc(entry.path)}?v=${entry.modified ?? 0}`} alt="" /></div>;
  else if (text === undefined) body = <p className="muted empty">読み込み中…</p>;
  else if (text === null) body = <p className="muted empty">このファイルはプレビューできません（大きすぎるか、文字のファイルではありません）</p>;
  else body = <Code text={text} lang={ext(entry.name)} />;

  return <aside className="preview-pane">{head}{tabs}{body}</aside>;
}

const ALIAS: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", rs: "rust", py: "python", rb: "ruby", kt: "kotlin", md: "markdown", yml: "yaml", sh: "bash", ps1: "powershell", cs: "csharp", h: "c", hpp: "cpp", htm: "xml", html: "xml", vue: "xml", toml: "ini", txt: "plaintext", log: "plaintext", csv: "plaintext" };

function Code({ text, lang }: { text: string; lang: string }) {
  const name = ALIAS[lang] ?? lang;
  const big = text.length > 300_000;
  let html: string;
  try {
    html = big || name === "plaintext" ? escape(text)
      : hljs.getLanguage(name) ? hljs.highlight(text, { language: name, ignoreIllegals: true }).value
      : escape(text);
  } catch { html = escape(text); }
  const lines = html.split("\n");
  return (
    <div className="code-view">
      <table><tbody>
        {lines.map((l, i) => (
          <tr key={i}><td className="ln">{i + 1}</td><td className="hljs-line" dangerouslySetInnerHTML={{ __html: l || " " }} /></tr>
        ))}
      </tbody></table>
    </div>
  );
}
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 変更点：追加は緑、削除は赤。左に変更前・変更後の行番号。 */
function Diff({ text }: { text: string }) {
  if (!text.trim()) return <p className="muted empty">最後の保存から変わっていません</p>;
  const rows: { o: number | null; n: number | null; kind: string; s: string }[] = [];
  let o = 0, n = 0;
  for (const line of text.split("\n")) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { o = +m[1]; n = +m[2]; rows.push({ o: null, n: null, kind: "hunk", s: "⋯" }); continue; }
    const c = line[0];
    if (c === "+") rows.push({ o: null, n: n++, kind: "add", s: line.slice(1) });
    else if (c === "-") rows.push({ o: o++, n: null, kind: "del", s: line.slice(1) });
    else if (c === " ") rows.push({ o: o++, n: n++, kind: "", s: line.slice(1) });
  }
  return (
    <div className="code-view diff-view">
      <table><tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.kind}>
            <td className="ln">{r.o ?? ""}</td><td className="ln">{r.n ?? ""}</td>
            <td className="sign">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""}</td>
            <td>{r.s || " "}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
