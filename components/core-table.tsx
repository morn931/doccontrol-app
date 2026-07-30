"use client";

// CoreTable — the Coreflow standard data table.
//
// Brand rule (2026-07-12, aligned with the platform-wide table standard):
// navy (#0B3563) fills the header band, white bold text on top; cyan
// (#00B8C4) marks active sort + resize-handle hover; teal fills active
// filter chips (soft bg-teal-50/text-teal-800, not a solid navy fill).
// Data cells stay neutral; colour in cells is reserved for meaning
// (status chips, negative values). Column borders + row borders both
// present, matching every other module's tables.
//
// Features: click-to-sort (asc → desc → off), drag-to-resize columns with
// per-user persistence (localStorage, keyed by tableId), sticky header,
// whisper zebra + cyan hover tint, footer band, empty state, CSV export
// helper, and composable toolbar primitives (Chip / SearchBox).
//
// Vendored per app — keep this file self-contained. v1 (2026-07-10).

import { Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

export const CF = {
  navy: "#0B3563",
  cyan: "#00B8C4",
  headerBg: "#F4F7FA",
  zebra: "#FAFCFD",
  hover: "#F0FBFC",
};

export type CoreColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** value used for sorting; omit to make the column unsortable */
  sortValue?: (row: T) => string | number | null;
  align?: "left" | "right" | "center";
  /** CSV cell text; omit to exclude the column from export */
  csv?: (row: T) => string | number | null;
  headerTitle?: string;
};

type Sort = { key: string; dir: "asc" | "desc" } | null;

function loadWidths(tableId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(`coretable:${tableId}:widths`) ?? "{}");
  } catch {
    return {};
  }
}

export function exportCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Toolbar filter pill. Soft teal when active, outlined when not -- matches
    the platform-wide coreflow teal accent standard used in every module. */
export function Chip({ active, onClick, children, title }: {
  active: boolean; onClick: () => void; children: ReactNode; title?: string;
}) {
  return (
    <button onClick={onClick} title={title}
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active ? "border-teal-300 bg-teal-50 text-teal-800" : "border-[#c6cfd9] text-[#3d4c5c] bg-white"
      }`}>
      {children}
    </button>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search…" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-44 rounded-md border border-neutral-300 px-2.5 py-1 text-xs outline-none focus:border-[#00B8C4]" />
  );
}

export default function CoreTable<T>({
  tableId, columns, rows, rowKey, defaultSort,
  footer, maxHeight = "78vh", emptyText = "No rows match the filter.",
  renderExpanded, expandedKey, rowStyle,
}: {
  tableId: string;
  columns: CoreColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** applied when the user hasn't chosen a sort */
  defaultSort?: (a: T, b: T) => number;
  /** cells for the footer band, keyed by column key */
  footer?: Partial<Record<string, ReactNode>>;
  maxHeight?: string;
  emptyText?: string;
  /** full-width panel rendered under the row whose key === expandedKey */
  renderExpanded?: (row: T) => ReactNode;
  expandedKey?: string | null;
  rowStyle?: (row: T) => React.CSSProperties | undefined;
}) {
  const [sort, setSort] = useState<Sort>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  useEffect(() => setWidths(loadWidths(tableId)), [tableId]);

  const persistWidths = useCallback((w: Record<string, number>) => {
    setWidths(w);
    try { localStorage.setItem(`coretable:${tableId}:widths`, JSON.stringify(w)); } catch { /* private mode */ }
  }, [tableId]);

  const cycleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));

  const startResize = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th") as HTMLElement;
    const startX = e.clientX;
    const startWidth = th.offsetWidth;
    let next = widths;
    const onMove = (ev: MouseEvent) => {
      next = { ...next, [key]: Math.max(48, startWidth + (ev.clientX - startX)) };
      setWidths(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      persistWidths(next);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetWidth = (key: string) => () => {
    const { [key]: _, ...rest } = widths;
    persistWidths(rest);
  };

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (!sort) return defaultSort ? copy.sort(defaultSort) : copy;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return copy;
    const mul = sort.dir === "asc" ? 1 : -1;
    return copy.sort((a, b) => {
      const va = col.sortValue!(a), vb = col.sortValue!(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
      return String(va).localeCompare(String(vb)) * mul;
    });
  }, [rows, sort, columns, defaultSort]);

  const alignClass = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div className="cf-scroll mt-4 overflow-auto rounded-lg border border-neutral-200" style={{ maxHeight }}>
      <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={{ width: widths[c.key] ?? 140 }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} title={c.headerTitle}
                  className={`sticky top-0 z-20 relative px-3 py-2 text-[11px] font-semibold uppercase tracking-wider ${alignClass(c.align)} ${c.sortValue ? "cursor-pointer select-none" : ""}`}
                  style={{
                    background: CF.navy, color: "#fff",
                    boxShadow: active ? `inset 0 -2px 0 ${CF.cyan}` : "none",
                    borderRight: "1px solid rgba(255,255,255,0.15)",
                  }}
                  onClick={c.sortValue ? () => cycleSort(c.key) : undefined}>
                  {c.header}
                  {active && <span className="ml-1" style={{ color: CF.cyan }}>{sort!.dir === "asc" ? "▲" : "▼"}</span>}
                  <span onMouseDown={startResize(c.key)} onDoubleClick={resetWidth(c.key)} onClick={(e) => e.stopPropagation()}
                    title="Drag to resize · double-click to reset"
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none"
                    style={{ background: "transparent" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = CF.cyan)}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
          {sorted.map((row, i) => {
            const k = rowKey(row);
            const expanded = expandedKey === k;
            return (
              <Fragment key={k}>
                <tr onMouseEnter={() => setHoverKey(k)} onMouseLeave={() => setHoverKey(null)}
                  className="border-t border-neutral-100 align-top"
                  style={{
                    background: hoverKey === k ? CF.hover : expanded ? CF.headerBg : i % 2 === 1 ? CF.zebra : "#fff",
                    ...rowStyle?.(row),
                  }}>
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${alignClass(c.align)}`} style={{ borderRight: "1px solid #e3e8ee" }}>{c.render(row, i)}</td>
                  ))}
                </tr>
                {expanded && renderExpanded && (
                  <tr className="border-t border-neutral-200">
                    <td colSpan={columns.length} className="px-3 py-2" style={{ background: CF.headerBg }}>
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-neutral-400">{emptyText}</td></tr>
          )}
        </tbody>
        {footer && (
          <tfoot>
            <tr style={{ background: CF.headerBg, borderTop: "1px solid #c6cfd9" }}>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 text-xs font-medium ${alignClass(c.align)}`} style={{ color: CF.navy }}>
                  {footer[c.key] ?? null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
