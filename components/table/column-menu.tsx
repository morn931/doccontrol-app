'use client'
import { ChevronUp, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// Excel-style table column header menu — sort A→Z/Z→A, type-ahead search,
// tick distinct values to filter. Originally built for the MDDR page; shared
// here so other tables (Aconex Review Tracker, etc.) get the identical
// interaction instead of a second implementation drifting out of sync.

export const BLANKS = '(Blanks)'

export interface ColFilter { search?: string; selected?: string[] }  // selected present ⇒ only those values
export type SortDir = 'asc' | 'desc'

export function sortRows<T extends Record<string, any>>(rows: T[], col: string, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = a[col] ?? ''
    const bv = b[col] ?? ''
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
    return dir === 'asc' ? cmp : -cmp
  })
}

export function ColumnMenu({
  label, anchor, values, filter, sortDir, onSort, onApply, onClear, onClose,
}: {
  label: string
  anchor: DOMRect
  values: string[]              // distinct display values available (given other filters)
  filter: ColFilter
  sortDir: SortDir | null
  onSort: (dir: SortDir) => void
  onApply: (f: ColFilter) => void
  onClear: () => void
  onClose: () => void
}) {
  const q = filter.search ?? ''
  const selectedSet = filter.selected ? new Set(filter.selected) : null   // null = all selected
  const shown = (q ? values.filter(v => v.toLowerCase().includes(q.toLowerCase())) : values).slice(0, 1000)
  const isChecked = (v: string) => !selectedSet || selectedSet.has(v)

  function setSelected(next: Set<string>) {
    onApply({ search: filter.search, selected: next.size === values.length ? undefined : [...next] })
  }
  function toggle(v: string) {
    const cur = new Set(filter.selected ?? values)
    if (cur.has(v)) cur.delete(v); else cur.add(v)
    setSelected(cur)
  }
  function selectAllShown(check: boolean) {
    const cur = new Set(filter.selected ?? values)
    shown.forEach(v => check ? cur.add(v) : cur.delete(v))
    setSelected(cur)
  }

  const left = Math.min(anchor.left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280)
  const allShownChecked = shown.every(isChecked)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 w-64 bg-white rounded-lg shadow-xl border border-slate-200 text-xs"
        style={{ left, top: anchor.bottom + 2 }} onClick={e => e.stopPropagation()}>
        <div className="px-3 py-2 border-b border-slate-100 font-semibold text-slate-700 truncate">{label}</div>

        {/* Sort */}
        <div className="flex border-b border-slate-100">
          <button onClick={() => { onSort('asc'); onClose() }}
            className={cn('flex-1 px-3 py-2 flex items-center gap-1.5 hover:bg-slate-50', sortDir === 'asc' && 'text-navy-700 font-semibold')}>
            <ChevronUp className="h-3.5 w-3.5" /> Sort A → Z
          </button>
          <button onClick={() => { onSort('desc'); onClose() }}
            className={cn('flex-1 px-3 py-2 flex items-center gap-1.5 border-l border-slate-100 hover:bg-slate-50', sortDir === 'desc' && 'text-navy-700 font-semibold')}>
            <ChevronDown className="h-3.5 w-3.5" /> Sort Z → A
          </button>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-slate-100 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input autoFocus value={q}
            onChange={e => onApply({ search: e.target.value, selected: filter.selected })}
            placeholder="Search…" className="input pl-7 pr-2 py-1 text-xs w-full" />
        </div>

        {/* Value checklist */}
        <label className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100 cursor-pointer select-none hover:bg-slate-50">
          <input type="checkbox" checked={allShownChecked} onChange={e => selectAllShown(e.target.checked)} className="rounded" />
          <span className="font-medium text-slate-600">{q ? 'Select all (results)' : 'Select all'}</span>
        </label>
        <div className="max-h-52 overflow-y-auto py-1">
          {shown.length === 0 && <p className="px-3 py-2 text-slate-400">No matches</p>}
          {shown.map(v => (
            <label key={v} className="flex items-center gap-2 px-3 py-1 cursor-pointer select-none hover:bg-slate-50">
              <input type="checkbox" checked={isChecked(v)} onChange={() => toggle(v)} className="rounded" />
              <span className={cn('truncate', v === BLANKS && 'text-slate-400 italic')}>{v}</span>
            </label>
          ))}
          {values.length > 1000 && <p className="px-3 py-1 text-slate-400">…refine with search ({values.length.toLocaleString()} values)</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100">
          <button onClick={onClear} className="text-slate-500 hover:text-red-600">Clear filter</button>
          <button onClick={onClose} className="btn-primary text-xs py-1 px-3">Done</button>
        </div>
      </div>
    </>
  )
}
