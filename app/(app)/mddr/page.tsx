'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, Upload, X, ChevronDown, ChevronUp, Filter,
  Loader2, ListChecks, RefreshCw, Download, Settings2,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { MddrUploadModal } from '@/components/mddr/MddrUploadModal'
import { cn } from '@/lib/utils/cn'

// ─── Column definitions ────────────────────────────────────────
interface ColDef {
  key: string
  label: string
  group: 'id' | 'classification' | 'dates' | 'progress' | 'schedule'
  defaultVisible: boolean
  width?: number
}

const COLUMNS: ColDef[] = [
  // Identity
  { key: 'activity_id',              label: 'Activity ID',        group: 'id',             defaultVisible: true,  width: 140 },
  { key: 'document_number',          label: 'Doc Number',         group: 'id',             defaultVisible: true,  width: 200 },
  { key: 'ppe_doc_number',           label: 'PPE / Vendor Doc',   group: 'id',             defaultVisible: false, width: 200 },
  { key: 'document_title',           label: 'Title',              group: 'id',             defaultVisible: true,  width: 260 },
  { key: 'package_code',             label: 'Package',            group: 'id',             defaultVisible: true,  width: 90  },
  { key: 'vendor_name',              label: 'Vendor / Origin',    group: 'id',             defaultVisible: true,  width: 120 },
  { key: 'source_type',              label: 'Source',             group: 'id',             defaultVisible: true,  width: 80  },
  // Classification
  { key: 'discipline',               label: 'Discipline',         group: 'classification', defaultVisible: true,  width: 120 },
  { key: 'document_type',            label: 'Doc Type',           group: 'classification', defaultVisible: true,  width: 120 },
  { key: 'deliverable_name',         label: 'Deliverable',        group: 'classification', defaultVisible: false, width: 200 },
  { key: 'equipment_description',    label: 'Equipment',          group: 'classification', defaultVisible: false, width: 200 },
  { key: 'sub_package',              label: 'Sub Package',        group: 'classification', defaultVisible: false, width: 180 },
  { key: 'document_category',        label: 'Category',           group: 'classification', defaultVisible: false, width: 100 },
  { key: 'area',                     label: 'Area',               group: 'classification', defaultVisible: false, width: 80  },
  { key: 'system',                   label: 'System',             group: 'classification', defaultVisible: false, width: 100 },
  { key: 'tag_number',               label: 'Tag No.',            group: 'classification', defaultVisible: false, width: 110 },
  // Revision & Status
  { key: 'revision',                 label: 'Rev',                group: 'id',             defaultVisible: true,  width: 60  },
  { key: 'revision_status',          label: 'Rev Status',         group: 'id',             defaultVisible: true,  width: 90  },
  { key: 'review_outcome_code',      label: 'Review Code',        group: 'id',             defaultVisible: true,  width: 100 },
  { key: 'document_status',          label: 'Status',             group: 'id',             defaultVisible: true,  width: 110 },
  // Dates
  { key: 'planned_start_date',       label: 'Plan Start',         group: 'dates',          defaultVisible: true,  width: 105 },
  { key: 'planned_ifr_date',         label: 'Plan IFR',           group: 'dates',          defaultVisible: true,  width: 100 },
  { key: 'planned_ifc_date',         label: 'Plan IFC',           group: 'dates',          defaultVisible: false, width: 100 },
  { key: 'planned_completion_date',  label: 'Plan Complete',      group: 'dates',          defaultVisible: false, width: 110 },
  { key: 'actual_submission_date',   label: 'Act. Submit',        group: 'dates',          defaultVisible: true,  width: 105 },
  { key: 'actual_review_date',       label: 'Act. Review',        group: 'dates',          defaultVisible: true,  width: 100 },
  { key: 'actual_return_date',       label: 'Act. Return',        group: 'dates',          defaultVisible: true,  width: 105 },
  { key: 'actual_completion_date',   label: 'Act. Complete',      group: 'dates',          defaultVisible: false, width: 110 },
  // Progress
  { key: 'progress_percent',         label: 'Progress %',         group: 'progress',       defaultVisible: true,  width: 100 },
  { key: 'weighting_total',          label: 'Weight',             group: 'progress',       defaultVisible: true,  width: 80  },
  { key: 'earned_value',             label: 'Earned Value',       group: 'progress',       defaultVisible: false, width: 110 },
  { key: 'weighting_primary',        label: 'Weight (1°)',        group: 'progress',       defaultVisible: false, width: 90  },
  { key: 'weighting_secondary',      label: 'Weight (2°)',        group: 'progress',       defaultVisible: false, width: 90  },
  // Misc
  { key: 'wbs_code',                 label: 'WBS',                group: 'schedule',       defaultVisible: false, width: 130 },
  { key: 'contract_number',          label: 'Contract No.',       group: 'schedule',       defaultVisible: false, width: 120 },
  { key: 'comments',                 label: 'Comments',           group: 'id',             defaultVisible: false, width: 200 },
  { key: 'remarks',                  label: 'Remarks',            group: 'id',             defaultVisible: false, width: 200 },
]

const DATE_COLS = new Set([
  'planned_start_date','planned_ifr_date','planned_ifc_date','planned_completion_date',
  'actual_submission_date','actual_review_date','actual_return_date','actual_completion_date',
])

const OUTCOME_COLORS: Record<string, string> = {
  A1: 'bg-green-100 text-green-800',
  B1: 'bg-blue-100 text-blue-800',
  B2: 'bg-blue-100 text-blue-700',
  C1: 'bg-yellow-100 text-yellow-800',
  D1: 'bg-red-100 text-red-800',
}

function fmtDate(v: string | null) {
  if (!v) return ''
  try { return format(parseISO(v), 'dd MMM yyyy') } catch { return v }
}

function fmtNum(v: number | null, decimals = 1) {
  if (v == null) return ''
  return v.toFixed(decimals)
}

const BLANKS = '(Blanks)'

/** Display string for a cell — used by the column filter checklist + matching. */
function cellText(row: any, key: string): string {
  const v = row[key]
  if (v == null || v === '') return ''
  if (DATE_COLS.has(key)) return fmtDate(v)
  if (key === 'progress_percent') return `${Number(v).toFixed(0)}%`
  return String(v)
}

// ─── Per-column filter state ──────────────────────────────────
interface ColFilter { search?: string; selected?: string[] }  // selected present ⇒ only those values

// ─── Sort helper ──────────────────────────────────────────────
type SortDir = 'asc' | 'desc'

function sortRows(rows: any[], col: string, dir: SortDir) {
  return [...rows].sort((a, b) => {
    const av = a[col] ?? ''
    const bv = b[col] ?? ''
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
    return dir === 'asc' ? cmp : -cmp
  })
}

// ─── Excel-style column header menu (sort / filter / type-ahead) ──
function ColumnMenu({
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
      <div className="fixed z-50 w-64 bg-white rounded-lg shadow-xl border border-gray-200 text-xs"
        style={{ left, top: anchor.bottom + 2 }} onClick={e => e.stopPropagation()}>
        <div className="px-3 py-2 border-b border-gray-100 font-semibold text-gray-700 truncate">{label}</div>

        {/* Sort */}
        <div className="flex border-b border-gray-100">
          <button onClick={() => { onSort('asc'); onClose() }}
            className={cn('flex-1 px-3 py-2 flex items-center gap-1.5 hover:bg-gray-50', sortDir === 'asc' && 'text-navy-700 font-semibold')}>
            <ChevronUp className="h-3.5 w-3.5" /> Sort A → Z
          </button>
          <button onClick={() => { onSort('desc'); onClose() }}
            className={cn('flex-1 px-3 py-2 flex items-center gap-1.5 border-l border-gray-100 hover:bg-gray-50', sortDir === 'desc' && 'text-navy-700 font-semibold')}>
            <ChevronDown className="h-3.5 w-3.5" /> Sort Z → A
          </button>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-gray-100 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input autoFocus value={q}
            onChange={e => onApply({ search: e.target.value, selected: filter.selected })}
            placeholder="Search…" className="input pl-7 pr-2 py-1 text-xs w-full" />
        </div>

        {/* Value checklist */}
        <label className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 cursor-pointer select-none hover:bg-gray-50">
          <input type="checkbox" checked={allShownChecked} onChange={e => selectAllShown(e.target.checked)} className="rounded" />
          <span className="font-medium text-gray-600">{q ? 'Select all (results)' : 'Select all'}</span>
        </label>
        <div className="max-h-52 overflow-y-auto py-1">
          {shown.length === 0 && <p className="px-3 py-2 text-gray-400">No matches</p>}
          {shown.map(v => (
            <label key={v} className="flex items-center gap-2 px-3 py-1 cursor-pointer select-none hover:bg-gray-50">
              <input type="checkbox" checked={isChecked(v)} onChange={() => toggle(v)} className="rounded" />
              <span className={cn('truncate', v === BLANKS && 'text-gray-400 italic')}>{v}</span>
            </label>
          ))}
          {values.length > 1000 && <p className="px-3 py-1 text-gray-400">…refine with search ({values.length.toLocaleString()} values)</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
          <button onClick={onClear} className="text-gray-500 hover:text-red-600">Clear filter</button>
          <button onClick={onClose} className="btn-primary text-xs py-1 px-3">Done</button>
        </div>
      </div>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function MddrPage() {
  const [packages,       setPackages]      = useState<string[]>([])
  const [vendors,        setVendors]       = useState<string[]>([])
  const [selPackage,     setSelPackage]    = useState<string>('ALL')
  const [selVendor,      setSelVendor]     = useState<string>('ALL')
  const [selSource,      setSelSource]     = useState<string>('ALL')
  const [awarded,        setAwarded]       = useState<'true' | 'false'>('true')  // awarded docs vs unawarded scope
  const [search,         setSearch]        = useState('')
  const [docSearch,      setDocSearch]     = useState('')   // quick client-side filter on Doc Number
  const [rows,           setRows]          = useState<any[]>([])
  const [loading,        setLoading]       = useState(false)
  const [totalCount,     setTotalCount]    = useState(0)
  const [error,          setError]         = useState<string | null>(null)
  const [showUpload,     setShowUpload]    = useState(false)
  const [syncing,        setSyncing]       = useState(false)
  const [showColPicker,  setShowColPicker] = useState(false)
  const [visibleCols,    setVisibleCols]   = useState<Set<string>>(
    new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  )
  const [sortCol,   setSortCol]  = useState<string>('activity_id')
  const [sortDir,   setSortDir]  = useState<SortDir>('asc')
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({})
  const [menuCol,    setMenuCol]    = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load available packages & vendors ──────────────────────
  useEffect(() => {
    fetch(`/api/mddr/meta?awarded=${awarded}&exclude_index=1`)
      .then(r => r.json())
      .then(d => {
        setPackages(d.packages ?? [])
        setVendors(d.vendors ?? [])
      })
      .catch(() => {})
  }, [awarded])

  // Update vendor list when package changes
  useEffect(() => {
    const base = `/api/mddr/meta?awarded=${awarded}&exclude_index=1`
    if (selPackage === 'ALL') {
      fetch(base)
        .then(r => r.json())
        .then(d => setVendors(d.vendors ?? []))
        .catch(() => {})
    } else {
      fetch(`${base}&package=${encodeURIComponent(selPackage)}`)
        .then(r => r.json())
        .then(d => setVendors(d.vendors ?? []))
        .catch(() => {})
      setSelVendor('ALL')
    }
  }, [selPackage, awarded])

  // ── Fetch rows ──────────────────────────────────────────────
  const fetchRows = useCallback(async (pkg: string, ven: string, src: string, q: string) => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams()
      if (pkg !== 'ALL') p.set('package', pkg)
      if (ven !== 'ALL') p.set('vendor',  ven)
      if (src !== 'ALL') p.set('source',  src)
      if (q)             p.set('q',       q)
      p.set('awarded', awarded)
      p.set('exclude_index', '1')   // register master only — Document-Index sectors live in Document Search
      p.set('limit', '10000')   // load full result set so the Doc Number filter finds any doc
      const res  = await fetch(`/api/mddr?${p}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Load failed'); setRows([]) }
      else { setRows(data.rows ?? []); setTotalCount(data.total ?? 0) }
    } catch (e: any) {
      setError(e.message); setRows([])
    } finally {
      setLoading(false)
    }
  }, [awarded])

  // Debounce search; immediate on filter chips
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchRows(selPackage, selVendor, selSource, search)
    }, search ? 300 : 0)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [selPackage, selVendor, selSource, search, fetchRows])

  // ── Column filters (Excel-style header menus) ───────────────
  const activeFilterCols = Object.keys(colFilters).filter(k => {
    const f = colFilters[k]
    return f && ((f.search && f.search.length) || Array.isArray(f.selected))   // [] is an active filter (show none)
  })
  function rowPasses(row: any, exceptKey?: string) {
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
      if ((!f.search || !f.search.length) && f.selected === undefined) delete next[key]  // keep [] (none selected)
      else next[key] = f
      return next
    })
  }
  // Distinct values for the open column (respecting the OTHER columns' filters).
  const menuValues = menuCol
    ? [...new Set(rows.filter(r => rowPasses(r, menuCol)).map(r => { const t = cellText(r, menuCol); return t === '' ? BLANKS : t }))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : []

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function toggleCol(key: string) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const displayedCols = COLUMNS.filter(c => visibleCols.has(c.key))

  // Freeze the leftmost columns up to & including Title so the doc number/title
  // stay visible while scrolling right. Compute each pinned column's left offset.
  const pinnedCount = (() => {
    const idx = displayedCols.findIndex(c => c.key === 'document_title')
    return idx >= 0 ? idx + 1 : 0
  })()
  const leftOffsets: number[] = []
  for (let i = 0, acc = 0; i < pinnedCount; i++) { leftOffsets[i] = acc; acc += displayedCols[i].width ?? 100 }

  // Apply column filters + the Doc Number quick filter, then sort.
  const filteredRows = rows.filter(r =>
    rowPasses(r) && (!docSearch || String(r.document_number ?? '').toLowerCase().includes(docSearch.toLowerCase())))
  const viewRows = sortRows(filteredRows, sortCol, sortDir)

  function renderCell(row: any, col: ColDef) {
    const v = row[col.key]
    if (v == null || v === '') return <span className="text-gray-300">—</span>

    if (DATE_COLS.has(col.key)) return <span className="whitespace-nowrap">{fmtDate(v)}</span>

    if (col.key === 'progress_percent') {
      const pct = Number(v)
      return (
        <div className="flex items-center gap-2 min-w-[80px]">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full',
                pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : pct > 0 ? 'bg-yellow-500' : 'bg-gray-200'
              )}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="text-xs font-medium w-9 text-right">{pct.toFixed(0)}%</span>
        </div>
      )
    }

    if (col.key === 'review_outcome_code') {
      return (
        <span className={cn('px-1.5 py-0.5 rounded text-xs font-semibold', OUTCOME_COLORS[v] ?? 'bg-gray-100 text-gray-700')}>
          {v}
        </span>
      )
    }

    if (col.key === 'source_type') {
      const colors: Record<string, string> = {
        SDDR: 'bg-purple-100 text-purple-700',
        CDDL: 'bg-teal-100 text-teal-700',
        MDDR: 'bg-navy-100 text-navy-700',
      }
      return <span className={cn('px-1.5 py-0.5 rounded text-xs font-semibold', colors[v] ?? 'bg-gray-100 text-gray-700')}>{v}</span>
    }

    if (col.key === 'weighting_total' || col.key === 'weighting_primary' || col.key === 'weighting_secondary') {
      return <span>{fmtNum(v, 4)}</span>
    }
    if (col.key === 'earned_value') {
      return <span>{fmtNum(v, 4)}</span>
    }

    return <span className="truncate block max-w-[260px]">{String(v)}</span>
  }

  // ── Sync progress from review system ────────────────────────
  async function syncProgress() {
    setSyncing(true)
    try {
      const body = selPackage !== 'ALL' ? { package_code: selPackage } : {}
      await fetch('/api/mddr/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      fetchRows(selPackage, selVendor, selSource, search)
    } finally {
      setSyncing(false)
    }
  }

  // ── CSV export ──────────────────────────────────────────────
  function exportCSV() {
    const headers = displayedCols.map(c => c.label)
    const dataRows = viewRows.map(row =>
      displayedCols.map(col => {
        const v = row[col.key]
        if (v == null) return ''
        if (DATE_COLS.has(col.key)) return fmtDate(v)
        return String(v)
      })
    )
    const csv = [headers, ...dataRows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `MDDR-${selPackage === 'ALL' ? 'All' : selPackage}-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-4 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-navy-600" />
            Master Document & Drawing Register
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Combined SDDR · CDDL · MDDR — {totalCount.toLocaleString()} entries
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={syncProgress} disabled={syncing} className="btn-secondary text-xs py-1.5 px-3">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync Progress
          </button>
          <button onClick={exportCSV} className="btn-secondary text-xs py-1.5 px-3"><Download className="h-3.5 w-3.5" /> Export CSV</button>
          <button onClick={() => setShowColPicker(p => !p)} className="btn-secondary text-xs py-1.5 px-3"><Settings2 className="h-3.5 w-3.5" /> Columns</button>
          <button onClick={() => setShowUpload(true)}  className="btn-primary  text-xs py-1.5 px-3"><Upload className="h-3.5 w-3.5" /> Upload Register</button>
        </div>
      </div>

      {/* Package filter chips */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Package:</span>
        {['ALL', ...packages].map(pkg => (
          <button
            key={pkg}
            onClick={() => setSelPackage(pkg)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
              selPackage === pkg
                ? 'bg-navy-700 text-white border-navy-700'
                : 'bg-white text-gray-600 border-gray-300 hover:border-navy-400 hover:text-navy-700'
            )}
          >
            {pkg}
          </button>
        ))}
      </div>

      {/* Vendor + Source + Search row */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor:</span>
        {['ALL', ...vendors].map(v => (
          <button
            key={v}
            onClick={() => setSelVendor(v)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
              selVendor === v
                ? 'bg-teal-600 text-white border-teal-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-teal-400 hover:text-teal-700'
            )}
          >
            {v}
          </button>
        ))}

        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide ml-2">Source:</span>
        {['ALL','SDDR','CDDL','MDDR'].map(s => (
          <button
            key={s}
            onClick={() => setSelSource(s)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
              selSource === s
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-700'
            )}
          >
            {s}
          </button>
        ))}

        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide ml-2">Show:</span>
        {([['true', 'Awarded docs'], ['false', 'Unawarded scope']] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setAwarded(val)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
              awarded === val
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400 hover:text-amber-700'
            )}
          >
            {label}
          </button>
        ))}

        {/* Free-text search */}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search doc number, title, tag…"
            className="input pl-8 pr-8 py-1.5 text-xs w-64"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {loading && <Loader2 className="h-4 w-4 text-navy-500 animate-spin" />}
        <button onClick={() => fetchRows(selPackage, selVendor, selSource, search)} className="text-gray-400 hover:text-navy-600">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Column picker dropdown */}
      {showColPicker && (
        <div className="card p-4 border-navy-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-700">Visible Columns</span>
            <button onClick={() => setShowColPicker(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-3 gap-x-6 gap-y-2">
            {COLUMNS.map(col => (
              <label key={col.key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visibleCols.has(col.key)}
                  onChange={() => toggleCol(col.key)}
                  className="rounded"
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}

      {/* Doc Number quick filter (top-left of the table) */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            value={docSearch}
            onChange={e => setDocSearch(e.target.value)}
            placeholder="Find document number…"
            className="input pl-8 pr-8 py-1.5 text-xs w-80"
          />
          {docSearch && (
            <button onClick={() => setDocSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {activeFilterCols.length > 0 && (
          <button onClick={() => setColFilters({})}
            className="text-xs font-semibold text-navy-700 border border-navy-200 bg-navy-50 rounded-full px-3 py-1 hover:bg-navy-100 inline-flex items-center gap-1">
            <Filter className="h-3 w-3" /> {activeFilterCols.length} column filter{activeFilterCols.length === 1 ? '' : 's'} · Clear
          </button>
        )}
        <span className="text-xs text-gray-500 ml-auto">{viewRows.length.toLocaleString()} of {rows.length.toLocaleString()} shown</span>
      </div>

      {/* Table — bounded height so the horizontal scrollbar stays visible while
          scrolling rows; leftmost columns (through Title) are frozen. */}
      <div className="card overflow-auto max-h-[calc(100vh-16rem)]">
        {viewRows.length === 0 && !loading ? (
          <div className="py-20 text-center text-gray-400">
            <ListChecks className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-gray-500">No entries found</p>
            <p className="text-sm mt-1">{docSearch ? 'No document number matches that search' : 'Upload registers or adjust your filters'}</p>
          </div>
        ) : (
          <table className="min-w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-20">
              <tr>
                {displayedCols.map((col, i) => {
                  const pinned = i < pinnedCount
                  const hasFilter = !!colFilters[col.key]
                  return (
                    <th
                      key={col.key}
                      onClick={e => { setMenuCol(col.key); setMenuAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()) }}
                      style={{ minWidth: col.width ?? 100, ...(pinned ? { position: 'sticky', left: leftOffsets[i], top: 0 } : {}) }}
                      className={cn(
                        'px-3 py-2.5 text-left font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap select-none bg-gray-50 border-b border-gray-200',
                        pinned && 'z-30',
                        i === pinnedCount - 1 && 'border-r border-gray-200',
                      )}
                    >
                      <span className="flex items-center gap-1 w-full">
                        {col.label}
                        {sortCol === col.key && (
                          sortDir === 'asc'
                            ? <ChevronUp   className="h-3 w-3 shrink-0" />
                            : <ChevronDown className="h-3 w-3 shrink-0" />
                        )}
                        <Filter className={cn('h-3 w-3 ml-auto shrink-0', hasFilter ? 'text-navy-600 fill-navy-200' : 'text-gray-300')} />
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {viewRows.map((row, ri) => (
                <tr key={row.id ?? ri} className="group hover:bg-gray-50 transition-colors">
                  {displayedCols.map((col, i) => {
                    const pinned = i < pinnedCount
                    return (
                      <td
                        key={col.key}
                        style={pinned ? { position: 'sticky', left: leftOffsets[i] } : undefined}
                        className={cn(
                          'px-3 py-2 text-gray-700 align-middle border-b border-gray-50',
                          pinned && 'bg-white group-hover:bg-gray-50 z-10',
                          i === pinnedCount - 1 && 'border-r border-gray-200',
                        )}
                      >
                        {renderCell(row, col)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Excel-style column menu */}
      {menuCol && menuAnchor && (
        <ColumnMenu
          label={COLUMNS.find(c => c.key === menuCol)?.label ?? menuCol}
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

      {/* Footer count */}
      {rows.length > 0 && (
        <div className="text-xs text-gray-400 text-right pr-1">
          Showing {viewRows.length.toLocaleString()} of {totalCount.toLocaleString()} entries
          {docSearch && ` · filtered by "${docSearch}"`}
          {selPackage !== 'ALL' && ` · Package ${selPackage}`}
          {selVendor !== 'ALL' && ` · ${selVendor}`}
          {selSource !== 'ALL' && ` · ${selSource}`}
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <MddrUploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => {
            setShowUpload(false)
            fetchRows(selPackage, selVendor, selSource, search)
            // Refresh meta
            fetch('/api/mddr/meta').then(r => r.json()).then(d => {
              setPackages(d.packages ?? [])
              setVendors(d.vendors ?? [])
            })
          }}
        />
      )}
    </div>
  )
}
