'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Table2, Loader2, Download, RefreshCw, ArrowLeft, Info } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { PackageProgress } from '@/lib/reporting/package-progress'

type Kind = 'num' | 'pct' | 'var' | 'text'
interface Col { key: keyof PackageProgress; label: string; kind: Kind; width: number }

const COLS: Col[] = [
  { key: 'activeDocs',          label: 'Active Docs',        kind: 'num', width: 95 },
  { key: 'excludedDocs',        label: 'Excluded',           kind: 'num', width: 80 },
  { key: 'planToDateDocs',      label: 'Plan-to-Date Docs',  kind: 'num', width: 120 },
  { key: 'plannedToDatePct',    label: 'Planned % To Date',  kind: 'pct', width: 120 },
  { key: 'approvedDocs',        label: 'Approved (A1)',      kind: 'num', width: 105 },
  { key: 'approvalMatches',     label: 'Approval Matches',   kind: 'num', width: 115 },
  { key: 'actualProgressPct',   label: 'Actual Progress %',  kind: 'pct', width: 120 },
  { key: 'actualThisPeriodPct', label: 'This Period %',      kind: 'pct', width: 100 },
  { key: 'variancePct',         label: 'Variance',           kind: 'var', width: 95 },
  { key: 'missingDueDates',     label: 'Missing Due Dates',  kind: 'num', width: 120 },
  { key: 'sources',             label: 'Source(s)',          kind: 'text', width: 140 },
]

const fmtNum = (n: number) => (n ? n.toLocaleString() : '—')
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

function cell(row: PackageProgress, col: Col) {
  const v = row[col.key]
  if (col.kind === 'text') return Array.isArray(v) ? (v.join(', ') || '—') : String(v ?? '—')
  const n = Number(v ?? 0)
  if (col.kind === 'num') return fmtNum(n)
  return fmtPct(n)
}

export default function PackageProgressPage() {
  const [rows, setRows]   = useState<PackageProgress[]>([])
  const [total, setTotal] = useState<PackageProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10))
  const [generatedAt, setGeneratedAt] = useState('')
  const [selPackage, setSelPackage] = useState('ALL')

  function load() {
    setLoading(true); setError(null)
    fetch(`/api/reporting/package-progress?periodEnd=${periodEnd}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setRows([]); setTotal(null) }
        else { setRows(d.rows ?? []); setTotal(d.total ?? null); setGeneratedAt(d.generatedAt ?? '') }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [periodEnd])

  const packages = useMemo(() => rows.map(r => r.packageCode), [rows])
  const viewRows = selPackage === 'ALL' ? rows : rows.filter(r => r.packageCode === selPackage)

  function exportCSV() {
    const header = ['Package', ...COLS.map(c => c.label)]
    const out = [...viewRows, ...(selPackage === 'ALL' && total ? [total] : [])].map(r => [
      r.packageCode,
      ...COLS.map(c => (c.kind === 'text' ? (Array.isArray(r[c.key]) ? (r[c.key] as string[]).join(' ') : '')
        : c.kind === 'num' ? String(r[c.key] ?? 0)
        : (Number(r[c.key] ?? 0) * 100).toFixed(1) + '%')),
    ])
    const csv = [header, ...out].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `Package-Progress-${selPackage}-${periodEnd}.csv`
    a.click()
  }

  function renderRow(r: PackageProgress, heavy = false) {
    return (
      <tr key={r.packageCode} className={cn('group', heavy ? 'bg-gray-100 font-semibold' : 'hover:bg-amber-50')}>
        <td style={{ position: 'sticky', left: 0 }}
          className={cn('border-b border-r border-gray-200 px-3 py-2 font-medium text-gray-800',
            heavy ? 'bg-gray-100' : 'bg-white group-hover:bg-amber-50')}>
          {r.packageCode}
        </td>
        {COLS.map(c => {
          const isVar = c.kind === 'var'
          const n = Number(r[c.key] ?? 0)
          return (
            <td key={c.key as string}
              className={cn('border-b border-gray-100 px-2 py-2 whitespace-nowrap',
                c.kind === 'text' ? 'text-left text-gray-500' : 'text-right tabular-nums',
                isVar && (n >= 0 ? 'text-green-700' : 'text-red-600'))}>
              {isVar && n > 0 ? '+' : ''}{cell(r, c)}
            </td>
          )
        })}
      </tr>
    )
  }

  return (
    <div className="space-y-4 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reporting" className="text-xs text-gray-400 hover:text-navy-600 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Reporting
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Table2 className="h-6 w-6 text-navy-600" /> Package Progress Summary
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Per-package document counts & progress, live from the MDDR
            {generatedAt && ` · generated ${new Date(generatedAt).toLocaleString()}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          <button onClick={exportCSV} className="btn-secondary text-xs py-1.5 px-3"><Download className="h-3.5 w-3.5" /> Export CSV</button>
          <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Package:</span>
          {['ALL', ...packages].map(p => (
            <button key={p} onClick={() => setSelPackage(p)}
              className={cn('px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
                selPackage === p ? 'bg-navy-700 text-white border-navy-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-navy-400 hover:text-navy-700')}>
              {p}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <span className="font-semibold text-gray-500 uppercase tracking-wide">As of:</span>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="input py-1 text-xs" />
        </label>
      </div>

      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}

      {/* Table */}
      <div className="card overflow-auto max-h-[calc(100vh-19rem)]">
        <table className="text-xs border-separate border-spacing-0 min-w-full">
          <thead className="sticky top-0 z-20">
            <tr>
              <th style={{ position: 'sticky', left: 0, minWidth: 110 }}
                className="z-30 bg-navy-50 border-b border-r border-gray-200 px-3 py-2 text-left font-bold text-gray-700">
                Package
              </th>
              {COLS.map(c => (
                <th key={c.key as string} style={{ minWidth: c.width }}
                  className="bg-gray-50 border-b border-gray-200 px-2 py-2 text-right font-semibold text-gray-500 whitespace-nowrap last:text-left">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {viewRows.map(r => renderRow(r))}
            {selPackage === 'ALL' && total && renderRow(total, true)}
          </tbody>
        </table>
      </div>

      {/* Note */}
      <div className="card p-3 bg-blue-50/50 border-blue-100 text-xs text-gray-600 flex gap-2">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <p>
          <b>Active Docs</b> = awarded documents in the MDDR for the package.
          <b> Actual Progress %</b> = average Rules-of-Credit progress (25/75/85/100) across those docs.
          <b> Planned % To Date</b> = share of docs whose planned (due) date is on/before the “As of” date.
          <b> Approved (A1)</b> = docs with an A1 review outcome; <b>Approval Matches</b> = docs matched to the live review system.
          <b> Variance</b> = Actual − Planned. <i>Excluded</i> and <i>This Period %</i> are not yet tracked in the MDDR (shown as 0).
        </p>
      </div>
    </div>
  )
}
