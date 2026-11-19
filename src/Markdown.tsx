import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "./i18n";

export const isMarkdown = (name: string) => /\.(md|markdown|mdx)$/i.test(name) || /^readme$/i.test(name);

/** Markdown を読みやすく表示する。baseDir があれば、相対パスの画像も PC から読み込む。 */
export function Markdown({ text, baseDir }: { text: string; baseDir?: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { gfm: true, breaks: false, async: false }) as string;
    const clean = DOMPurify.sanitize(raw);
    const doc = new DOMParser().parseFromString(clean, "text/html");
    doc.querySelectorAll("pre code").forEach((el) => {
      const lang = [...el.classList].find((c) => c.startsWith("language-"))?.slice(9);
      try {
        el.innerHTML = lang && hljs.getLanguage(lang) ? hljs.highlight(el.textContent ?? "", { language: lang }).value : hljs.highlightAuto(el.textContent ?? "").value;
        el.classList.add("hljs");
      } catch { /* 色付けできなくてもそのまま */ }
    });
    if (baseDir) doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (src && !/^[a-z]+:/i.test(src) && !src.startsWith("//")) {
        img.setAttribute("src", convertFileSrc(`${baseDir}\${decodeURI(src).replace(/^\.?[\/]/, "").replace(/\//g, "\\")}`));
      }
    });
    return doc.body.innerHTML;
  }, [text, baseDir]);
  return (
    <div className="md-view" dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute("href") ?? "";
        if (/^https?:/i.test(href)) openUrl(href);
        else if (href.startsWith("#")) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
      }} />
  );
}

/** 「表示／ソース」を切り替えられる Markdown。 */
export function MarkdownToggle({ text, baseDir, source }: { text: string; baseDir?: string; source: React.ReactNode }) {
  const [raw, setRaw] = useState(false);
  return (
    <>
      <div className="preview-tabs">
        <button className={"small" + (!raw ? " on" : "")} onClick={() => setRaw(false)}>{t("表示")}</button>
        <button className={"small" + (raw ? " on" : "")} onClick={() => setRaw(true)}>{t("ソース")}</button>
      </div>
      {raw ? source : <Markdown text={text} baseDir={baseDir} />}
    </>
  );
}
