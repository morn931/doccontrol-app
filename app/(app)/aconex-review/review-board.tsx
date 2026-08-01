'use client'
import { useMemo, useState } from 'react'
import { Filter } from 'lucide-react'
import { ColumnMenu, BLANKS, sortRows, type ColFilter, type SortDir } from '@/components/table/column-menu'

export type ReviewRow = {
  doc_id: string
  docno: string
  title: string | null
  discipline: string | null
  revision: string | null
  doc_status: string | null
  review_status: string | null
  court: string
  court_label: string | null
  court_basis: string | null
  overdue: boolean
  days_in_court: number | null
  date_modified: string | null
  package_code: string
  doc_owner?: string | null
  cddl_due?: string | null
}

const COURT = {
  RDMC:            { label: 'RDMC — awaiting review', chip: 'bg-amber-100 text-amber-800 border-amber-200' },
  PPE:             { label: 'PPE — our action',       chip: 'bg-rose-100 text-rose-800 border-rose-200' },
  CLOSED:          { label: 'Closed',                 chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  NOT_TRANSMITTED: { label: 'Not yet submitted — PPE', chip: 'bg-purple-100 text-purple-800 border-purple-200' },
  UNKNOWN:         { label: 'Unknown',                chip: 'bg-slate-100 text-slate-500 border-slate-200' },
} as const

type CourtKey = keyof typeof COURT

const isCancelled = (r: ReviewRow) => (r.title ?? '').trim().toUpperCase().startsWith('CANCELLED')
// "Rev 0 & higher" = a numeric revision (0, 1, 2, ...) — issued revisions, vs A/B/... preliminaries.
const isRev0Plus = (r: ReviewRow) => /^\d+$/.test((r.revision ?? '').trim())

const PKG_LABELS: Record<string, string> = { K124: 'Phase 1 (K124)', K038: 'Early Works (K038)' }

// Columns with a small, repeating set of values — good candidates for the
// Excel-style tick-list filter. Document No/Title stay covered by the search
// box above; Days stays a plain sortable number.
const FILTERABLE_COLS: { key: string; label: string }[] = [
  { key: 'discipline',    label: 'Disc.' },
  { key: 'revision',      label: 'Rev' },
  { key: 'review_status', label: 'Review status' },
  { key: 'court',         label: 'Whose court' },
  { key: 'doc_owner',     label: 'Owner' },
]

function cellText(row: ReviewRow, key: string): string {
  switch (key) {
    case 'discipline':    return (row.discipline ?? '').split(' ')[0]
    case 'revision':      return row.revision ?? ''
    case 'review_status': return row.review_status ?? ''
    case 'court':         return row.court_label ?? COURT[(row.court as CourtKey)]?.label ?? row.court
    case 'doc_owner':     return row.doc_owner ?? ''
    default:               return ''
  }
}

export interface OwnerRosters { phase1: string[]; allStaff: string[] }

// Should a raw Owner value be offered as a selectable filter option?
// - Combined entries ("A or B", "A, B") and bare initials ("AP", "BR/SD") are
//   never resolvable to one person, so they're always excluded.
// - A clean single name: shown if it's on the K124 (X146/X153) roster, hidden
//   if CoreTime knows them as staff on a DIFFERENT project (provably not
//   K124), and shown if CoreTime has no record of them at all — that's the
//   RDMC/unknown case, which we can't disprove, so it stays selectable rather
//   than getting silently hidden (agreed with Liezl 2026-08-01).
function isSelectableOwner(raw: string, rosters: { phase1: Set<string>; allStaff: Set<string> } | null): boolean {
  const cleaned = raw.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (/\bor\b|[,/]/i.test(cleaned)) return false   // combined names
  if (!/\s/.test(cleaned)) return false            // no space ⇒ initials/code, not a full name
  if (!rosters) return true                        // CoreTime unreachable — don't filter
  if (rosters.phase1.has(cleaned)) return true      // confirmed K124A/K124B staff
  if (rosters.allStaff.has(cleaned)) return false   // known PPE staff — but on a different project
  return true                                       // unknown to CoreTime — can't disprove, allow
}

export function ReviewBoard({ rows, ownerRosters }: { rows: ReviewRow[]; ownerRosters?: OwnerRosters | null }) {
  // null/undefined = couldn't reach CoreTime — don't filter, never hide everyone.
  const ownerRoster = useMemo(
    () => (ownerRosters ? { phase1: new Set(ownerRosters.phase1), allStaff: new Set(ownerRosters.allStaff) } : null),
    [ownerRosters],
  )
  const [filter, setFilter] = useState<'ALL' | CourtKey | 'REV0PLUS'>('ALL')
  const [q, setQ] = useState('')
  const [excludeCancelled, setExcludeCancelled] = useState(true)
  const [pkgSel, setPkgSel] = useState('K124')
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({})
  const [menuCol, setMenuCol] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const pkgs = useMemo(() => Array.from(new Set(rows.map(r => r.package_code))).sort(), [rows])
  const pkg = pkgs.includes(pkgSel) ? pkgSel : (pkgs[0] ?? 'K124')
  const pkgRows = useMemo(() => rows.filter(r => r.package_code === pkg), [rows, pkg])

  const cancelledCount = useMemo(() => pkgRows.filter(isCancelled).length, [pkgRows])
  const base = useMemo(
    () => (excludeCancelled ? pkgRows.filter(r => !isCancelled(r)) : pkgRows),
    [pkgRows, excludeCancelled],
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: base.length, REV0PLUS: 0 }
    for (const r of base) {
      c[r.court] = (c[r.court] ?? 0) + 1
      if (isRev0Plus(r)) c.REV0PLUS += 1
    }
    return c
  }, [base])

  const overdue = useMemo(() => base.filter(r => r.overdue).length, [base])

  // ── Column filters (Excel-style header menus) ──────────────
  const activeFilterCols = Object.keys(colFilters).filter(k => {
    const f = colFilters[k]
    return f && ((f.search && f.search.length) || Array.isArray(f.selected))   // [] is an active filter (show none)
  })
  function rowPasses(row: ReviewRow, exceptKey?: string) {
    for (const key of activeFilterCols) {
      if (key === exceptKey) continue
      const f = colFilters[key]
      const t = cellText(row, key)
      if (f.search && !t.toLowerCase().includes(f.search.toLowerCase())) return false
      if (f.selected && !f.selected.includes(t === '' ? BLANKS : t)) return false  // [] ⇒ excludes everything
    }
    return true
  }
  function setColFilter(key: string, f: ColFilter) {
    setColFilters(prev => {
      const next = { ...prev }
      if ((!f.search || !f.search.length) && f.selected === undefined) delete next[key]
      else next[key] = f
      return next
    })
  }
  // Distinct values for the open column — respects the search box, court/rev0
  // card filter, and OTHER columns' filters, but not this column's own.
  const quickFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return base.filter(r => {
      if (filter === 'REV0PLUS' && !isRev0Plus(r)) return false
      if (filter !== 'ALL' && filter !== 'REV0PLUS' && r.court !== filter) return false
      if (needle && !(`${r.docno} ${r.title ?? ''} ${r.discipline ?? ''} ${r.doc_owner ?? ''}`.toLowerCase().includes(needle)))
        return false
      return true
    })
  }, [base, filter, q])
  const menuValues = menuCol
    ? [...new Set(quickFiltered.filter(r => rowPasses(r, menuCol)).map(r => { const t = cellText(r, menuCol); return t === '' ? BLANKS : t }))]
        // Owner: combined names / bare initials never offered; a clean single
        // name is offered unless CoreTime proves them staffed elsewhere (see
        // isSelectableOwner). Raw doc_owner text still shows as-is in the
        // table regardless — this only shapes the filter's selectable options.
        .filter(v => menuCol !== 'doc_owner' || v === BLANKS || isSelectableOwner(v, ownerRoster))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : []

  const shown = useMemo(() => {
    const filtered = quickFiltered.filter(r => rowPasses(r))
    return sortCol ? sortRows(filtered, sortCol, sortDir) : filtered
  }, [quickFiltered, colFilters, sortCol, sortDir])

  const cards: Array<{ key: 'ALL' | CourtKey | 'REV0PLUS'; label: string; n: number; accent: string }> = [
    { key: 'ALL',             label: 'All documents',            n: counts.ALL ?? 0,             accent: 'text-navy-700' },
    { key: 'RDMC',            label: 'Awaiting RDMC review',     n: counts.RDMC ?? 0,            accent: 'text-amber-700' },
    { key: 'PPE',             label: 'PPE action needed',        n: counts.PPE ?? 0,             accent: 'text-rose-700' },
    { key: 'NOT_TRANSMITTED', label: 'Not yet submitted (PPE)',  n: counts.NOT_TRANSMITTED ?? 0, accent: 'text-purple-700' },
    { key: 'REV0PLUS',        label: 'Rev 0 & higher (issued)',  n: counts.REV0PLUS ?? 0,        accent: 'text-emerald-700' },
    { key: 'CLOSED',          label: 'Closed',                   n: counts.CLOSED ?? 0,          accent: 'text-slate-600' },
  ]

  return (
    <div className="space-y-4">
      {pkgs.length > 1 && (
        <div className="flex gap-1 border-b border-slate-200">
          {pkgs.map(p => (
            <button
              key={p}
              onClick={() => { setPkgSel(p); setFilter('ALL') }}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition ${
                p === pkg
                  ? 'bg-white border-slate-200 text-navy-800 -mb-px'
                  : 'bg-slate-50 border-transparent text-slate-500 hover:text-navy-700'
              }`}
            >
              {PKG_LABELS[p] ?? p}
            </button>
          ))}
        </div>
      )}

      {/* Summary cards double as court filters */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {cards.map(c => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={`card p-4 text-left transition ${filter === c.key ? 'ring-2 ring-navy-400' : 'hover:border-navy-300'}`}
          >
            <div className={`text-2xl font-bold ${c.accent}`}>{c.n}</div>
            <div className="text-xs text-slate-500 mt-0.5">{c.label}</div>
          </button>
        ))}
      </div>

      {overdue > 0 && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ {overdue} document{overdue === 1 ? '' : 's'} awaiting RDMC review for over 180 days — likely stale, worth confirming with Document Control.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search doc no, title, discipline…"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-navy-300"
        />
        {filter !== 'ALL' && (
          <button onClick={() => setFilter('ALL')} className="text-xs text-navy-600 hover:underline">
            Clear filter ({filter === 'REV0PLUS' ? 'Rev 0 & higher' : COURT[filter as CourtKey]?.label ?? filter})
          </button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={excludeCancelled}
            onChange={e => setExcludeCancelled(e.target.checked)}
            className="rounded border-slate-300"
          />
          Exclude cancelled documents ({cancelledCount})
        </label>
        {activeFilterCols.length > 0 && (
          <button onClick={() => setColFilters({})}
            className="text-xs font-semibold text-navy-700 border border-navy-200 bg-navy-50 rounded-full px-3 py-1 hover:bg-navy-100 inline-flex items-center gap-1">
            <Filter className="h-3 w-3" /> {activeFilterCols.length} column filter{activeFilterCols.length === 1 ? '' : 's'} · Clear
          </button>
        )}
        <span className="text-xs text-slate-400 ml-auto">{shown.length} shown</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy-700 text-white text-left">
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Document No</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Title</th>
              {FILTERABLE_COLS.map(col => {
                const hasFilter = !!colFilters[col.key]
                return (
                  <th key={col.key}
                    onClick={e => { setMenuCol(col.key); setMenuAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()) }}
                    className="px-3 py-2 font-semibold border-r border-navy-600 cursor-pointer hover:bg-navy-800 select-none whitespace-nowrap"
                  >
                    <span className="flex items-center gap-1 w-full">
                      {col.label}
                      {sortCol === col.key && (sortDir === 'asc' ? '▲' : '▼')}
                      <Filter className={`h-3 w-3 ml-auto shrink-0 ${hasFilter ? 'text-brand fill-white/30' : 'text-white/40'}`} />
                    </span>
                  </th>
                )
              })}
              <th className="px-3 py-2 font-semibold text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const c = COURT[(r.court as CourtKey)] ?? COURT.UNKNOWN
              return (
                <tr key={r.docno + i} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    <a
                      href={`/aconex-review/view?doc=${encodeURIComponent(r.doc_id)}&name=${encodeURIComponent(r.docno)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-navy-600 hover:underline"
                    >
                      {r.docno}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-slate-700 max-w-xs">{r.title}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{(r.discipline ?? '').split(' ')[0]}</td>
                  <td className="px-3 py-2 text-slate-500">{r.revision}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.review_status}</td>
                  <td className="px-3 py-2">
                    <span
                      title={r.court_basis ?? ''}
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${c.chip} ${r.overdue ? 'ring-1 ring-amber-400' : ''}`}
                    >
                      {r.court_label ?? c.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap" title={r.cddl_due ? `CDDL due: ${r.cddl_due}` : ''}>
                    {r.doc_owner ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.days_in_court ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {menuCol && menuAnchor && (
        <ColumnMenu
          label={FILTERABLE_COLS.find(c => c.key === menuCol)?.label ?? menuCol}
          anchor={menuAnchor}
          values={menuValues}
          filter={colFilters[menuCol] ?? {}}
          sortDir={sortCol === menuCol ? sortDir : null}
          onSort={d => { setSortCol(menuCol); setSortDir(d) }}
          onApply={f => setColFilter(menuCol, f)}
          onClear={() => setColFilter(menuCol, {})}
          onClose={() => { setMenuCol(null); setMenuAnchor(null) }}
        />
      )}
    </div>
  )
}
