import { HTMLAttributes, ReactNode, useEffect, useRef, useState } from "react";
import { t } from "../i18n";

export type Column<R> = {
  id: string;
  label: ReactNode;
  width: number;
  cell: (r: R) => ReactNode;
  title?: (r: R) => string;
  className?: string;
  /** 見出しクリック（並べ替えなど） */
  onHeader?: () => void;
};

type Saved = { order: string[]; widths: Record<string, number>; hidden?: string[] };

/** 詳細表示の表：見出しをドラッグで並べ替え、右端をドラッグで幅を変える。はみ出した文字は「…」。並びと幅は覚えておく。 */
export default function ColumnTable<R>({ rows, columns, rowKey, rowProps, storageKey }: {
  rows: R[]; columns: Column<R>[]; rowKey: (r: R) => string;
  rowProps?: (r: R) => HTMLAttributes<HTMLTableRowElement>; storageKey: string;
}) {
  const [saved, setSaved] = useState<Saved>(() => {
    try { return { order: [], widths: {}, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}") }; } catch { return { order: [], widths: {} }; }
  });
  const save = (v: Saved) => { setSaved(v); try { localStorage.setItem(storageKey, JSON.stringify(v)); } catch { /* 表示だけなので無視 */ } };
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // 保存した並び → 新しく増えた列は末尾へ
  const ids = columns.map((c) => c.id);
  const order = [...saved.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !saved.order.includes(id))];
  const hidden = saved.hidden ?? [];
  const cols = order.filter((id) => !hidden.includes(id)).map((id) => columns.find((c) => c.id === id)!);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { if (!menu) return; const c = () => setMenu(null); window.addEventListener("click", c); return () => window.removeEventListener("click", c); }, [menu]);
  const toggle = (id: string) => {
    const h = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    if (h.length >= columns.length) return; // 全部は消せない
    save({ ...saved, hidden: h });
  };
  const width = (c: Column<R>) => saved.widths[c.id] ?? c.width;

  const dropCol = (drag: string, target: string) => {
    if (drag === target) return;
    const next = order.filter((id) => id !== drag);
    next.splice(next.indexOf(target) + (order.indexOf(drag) < order.indexOf(target) ? 1 : 0), 0, drag);
    save({ ...saved, order: next });
  };
  // 見出しをドラッグして列を移動（Tauri では HTML5 のドラッグが使えないためマウスで行う）
  const moved = useRef(false);
  const startMove = (id: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    moved.current = false;
    let target: string | null = null;
    const move = (ev: MouseEvent) => {
      if (!moved.current && Math.abs(ev.clientX - x0) < 6) return;
      moved.current = true; setDrag(id);
      const th = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("th[data-col]");
      target = th?.dataset.col ?? null; setOver(target);
    };
    const up = () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      if (moved.current && target) dropCol(id, target);
      setDrag(null); setOver(null);
      setTimeout(() => { moved.current = false; }, 0);
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const startResize = (c: Column<R>, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = width(c);
    let latest = saved;
    const move = (ev: MouseEvent) => {
      latest = { ...latest, widths: { ...latest.widths, [c.id]: Math.max(50, w0 + ev.clientX - x0) } };
      setSaved(latest);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); save(latest); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <>
    <table className="list coltable" style={{ width: cols.reduce((a, c) => a + width(c), 0) }}>
      <colgroup>{cols.map((c) => <col key={c.id} style={{ width: width(c) }} />)}</colgroup>
      <thead>
        <tr onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}>
          {cols.map((c) => (
            <th key={c.id} data-col={c.id} title={(c.onHeader ? t("クリックで並べ替え・ドラッグで列を移動") : t("ドラッグで列を移動")) + "\n" + t("右クリックで表示する列を選ぶ")}
              className={(c.className ?? "") + (drag === c.id ? " dragging" : "") + (over === c.id && drag && drag !== c.id ? " drop-here" : "")}
              onMouseDown={(e) => startMove(c.id, e)}
              onClick={() => { if (!moved.current) c.onHeader?.(); }}>
              {c.label}
              <span className="col-resize" title={t("ドラッグで幅を変更")} onMouseDown={(e) => startResize(c, e)} onClick={(e) => e.stopPropagation()} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)} {...rowProps?.(r)}>
            {cols.map((c) => {
              const v = c.cell(r);
              return <td key={c.id} className={c.className} title={c.title?.(r) ?? (typeof v === "string" ? v : undefined)}>{v}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
    {menu && (
      <div className="menu" style={{ position: "fixed", left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
        {order.map((id) => { const c = columns.find((x) => x.id === id)!; return (
          <div key={id} onClick={() => toggle(id)}>{hidden.includes(id) ? "　" : "✔"} {c.label}</div>
        ); })}
        <hr />
        <div onClick={() => { save({ order: [], widths: {}, hidden: [] }); setMenu(null); }}>{t("列を元に戻す")}</div>
      </div>
    )}
    </>
  );
}
