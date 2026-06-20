'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LineChart, Loader2, Download, RefreshCw, ArrowLeft, Info } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { TrackerRow } from '@/lib/reporting/engineering-tracker'
import { ENG_TRACKER_SECTIONS } from '@/lib/reporting/eng-tracker-config'

type Kind = 'pct' | 'hrs' | 'var' | 'text'
interface Col { key: keyof TrackerRow; group: string; label: string; kind: Kind; width: number }

const COLS: Col[] = [
  { key: 'pctDiscpl',     group: 'Ratios',        label: '% of Discpl',    kind: 'pct', width: 90 },
  { key: 'pctProj',       group: 'Ratios',        label: '% of Proj',      kind: 'pct', width: 90 },
  { key: 'origBudget',    group: 'Budget Hr Data',label: 'Orig Budget',    kind: 'hrs', width: 95 },
  { key: 'apprChg',       group: 'Budget Hr Data',label: 'Appr Chg',       kind: 'hrs', width: 80 },
  { key: 'currentBudget', group: 'Budget Hr Data',label: 'Current Budget', kind: 'hrs', width: 105 },
  { key: 'earnedPeriod',  group: 'Budget Hr Data',label: 'Earned (Per.)',  kind: 'hrs', width: 95 },
  { key: 'earnedToDate',  group: 'Budget Hr Data',label: 'Earned (ToDate)',kind: 'hrs', width: 105 },
  { key: 'baseToGo',      group: 'Budget Hr Data',label: 'Base Hrs',       kind: 'hrs', width: 90 },
  { key: 'fcstToGo',      group: 'Budget Hr Data',label: 'Fcst To Go',     kind: 'hrs', width: 95 },
  { key: 'fcstEopHrs',    group: 'Budget Hr Data',label: 'Fcst EOP',       kind: 'hrs', width: 90 },
  { key: 'expThisPeriod', group: 'Expended Hours',label: 'This Period',    kind: 'hrs', width: 95 },
  { key: 'expToDate',     group: 'Expended Hours',label: 'To Date',        kind: 'hrs', width: 90 },
  { key: 'expFcstEop',    group: 'Expended Hours',label: 'Fcst EOP',       kind: 'hrs', width: 90 },
  { key: 'expPctToDate',  group: 'Expended Hours',label: '% To Date',      kind: 'pct', width: 90 },
  { key: 'perfPeriod',    group: 'Performance',   label: 'Period Act.',    kind: 'pct', width: 90 },
  { key: 'perfToDate',    group: 'Performance',   label: 'To Date Act.',   kind: 'pct', width: 95 },
  { key: 'perfFcstToGo',  group: 'Performance',   label: 'Fcst To Go',     kind: 'pct', width: 90 },
  { key: 'perfFcstEop',   group: 'Performance',   label: 'Fcst EOP',       kind: 'pct', width: 85 },
  { key: 'progToDatePlan',group: 'Progress Data', label: 'Plan To Date',   kind: 'pct', width: 95 },
  { key: 'progToDateAct', group: 'Progress Data', label: 'Actual To Date', kind: 'pct', width: 100 },
  { key: 'progVar',       group: 'Progress Data', label: 'Var',            kind: 'var', width: 80 },
  { key: 'note',          group: 'Progress Data', label: 'Note',           kind: 'text',width: 320 },
]

// Ordered group spans for the top header row.
const GROUPS = COLS.reduce<{ name: string; span: number }[]>((acc, c) => {
  const last = acc[acc.length - 1]
  if (last && last.name === c.group) last.span++
  else acc.push({ name: c.group, span: 1 })
  return acc
}, [])

const PACKAGES = ENG_TRACKER_SECTIONS.flatMap(s => s.packages.map(p => p.code))

const fmtHrs = (n: number) => (n ? Math.round(n).toLocaleString() : '—')
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

function fmt(row: TrackerRow, col: Col) {
  const v = row[col.key]
  if (col.kind === 'text') return String(v ?? '')
  const n = Number(v ?? 0)
  if (col.kind === 'hrs') return fmtHrs(n)
  return fmtPct(n)
}

export default function EngineeringTrackerPage() {
  const [rows, setRows]       = useState<TrackerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10))
  const [basis, setBasis]     = useState<'hours' | 'docs'>('hours')
  const [selPackage, setSelPackage] = useState('ALL')
  const [generatedAt, setGeneratedAt] = useState('')

  function load() {
    setLoading(true); setError(null)
    fetch(`/api/reporting/engineering-tracker?periodEnd=${periodEnd}&basis=${basis}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setRows([]) }
        else { setRows(d.rows ?? []); setGeneratedAt(d.generatedAt ?? '') }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [periodEnd, basis])

  const viewRows = useMemo(() => {
    if (selPackage === 'ALL') return rows
    return rows.filter(r => r.code === selPackage)
  }, [rows, selPackage])

  function exportCSV() {
    const header = ['Description', ...COLS.map(c => `${c.group} - ${c.label}`)]
    const lines = viewRows.map(r => [
      r.description,
      ...COLS.map(c => (c.kind === 'text' ? String(r[c.key] ?? '') : c.kind === 'hrs' ? String(Math.round(Number(r[c.key] ?? 0))) : (Number(r[c.key] ?? 0) * 100).toFixed(1) + '%')),
    ])
    const csv = [header, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `Engineering-Tracker-${selPackage}-${periodEnd}.csv`
    a.click()
  }

  return (
    <div className="space-y-4 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reporting" className="text-xs text-slate-400 hover:text-navy-600 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Reporting
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <LineChart className="h-6 w-6 text-navy-600" /> Engineering Tracker
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Live from the MDDR · progress per the agreed Rules of Credit
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
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Package:</span>
          {['ALL', ...PACKAGES].map(p => (
            <button key={p} onClick={() => setSelPackage(p)}
              className={cn('px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
                selPackage === p ? 'bg-navy-700 text-white border-navy-700'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-navy-400 hover:text-navy-700')}>
              {p}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-500 uppercase tracking-wide">As of:</span>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="input py-1 text-xs" />
        </label>
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">% of Discpl by:</span>
          {(['hours', 'docs'] as const).map(b => (
            <button key={b} onClick={() => setBasis(b)}
              className={cn('px-2.5 py-1 rounded-full text-xs font-semibold border capitalize',
                basis === b ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-300')}>
              {b}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}

      {/* Table */}
      <div className="card overflow-auto max-h-[calc(100vh-19rem)]">
        <table className="text-xs border-separate border-spacing-0 min-w-full">
          <thead className="sticky top-0 z-20">
            <tr>
              <th rowSpan={2} style={{ position: 'sticky', left: 0, minWidth: 280 }}
                className="z-30 bg-navy-50 border-b border-r border-slate-200 px-3 py-2 text-left font-bold text-slate-700 align-bottom">
                Description
              </th>
              {GROUPS.map(g => (
                <th key={g.name} colSpan={g.span}
                  className="bg-slate-100 border-b border-l border-slate-200 px-3 py-1.5 text-center font-bold text-slate-600 uppercase tracking-wide whitespace-nowrap">
                  {g.name}
                </th>
              ))}
            </tr>
            <tr>
              {COLS.map((c, i) => (
                <th key={c.key as string} style={{ minWidth: c.width }}
                  className={cn('bg-slate-50 border-b border-slate-200 px-2 py-1.5 text-right font-semibold text-slate-500 whitespace-nowrap',
                    (i === 0 || COLS[i - 1].group !== c.group) && 'border-l')}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {viewRows.map((r, ri) => {
              if (r.kind === 'section') return (
                <tr key={ri}>
                  <td colSpan={COLS.length + 1}
                    style={{ position: 'sticky', left: 0 }}
                    className="bg-navy-700 text-white px-3 py-1.5 font-semibold text-xs uppercase tracking-wide">
                    {r.description}
                  </td>
                </tr>
              )
              const heavy = r.kind === 'subtotal' || r.kind === 'grand'
              return (
                <tr key={ri} className={cn('group', heavy ? 'bg-slate-50 font-semibold' : 'hover:bg-amber-50')}>
                  <td style={{ position: 'sticky', left: 0 }}
                    className={cn('border-b border-r border-slate-200 px-3 py-1.5 text-slate-800 align-middle',
                      heavy ? 'bg-slate-100 font-semibold' : 'bg-white group-hover:bg-amber-50',
                      r.kind === 'grand' && 'border-t-2 border-t-navy-300')}>
                    {r.description}
                  </td>
                  {COLS.map(c => {
                    const isVar = c.kind === 'var'
                    const n = Number(r[c.key] ?? 0)
                    return (
                      <td key={c.key as string}
                        className={cn('border-b border-slate-100 px-2 py-1.5 align-middle whitespace-nowrap',
                          c.kind === 'text' ? 'text-left text-slate-500 truncate max-w-[320px]' : 'text-right tabular-nums',
                          isVar && (n >= 0 ? 'text-green-700' : 'text-red-600'),
                          r.kind === 'grand' && 'border-t-2 border-t-navy-300')}>
                        {isVar && n > 0 ? '+' : ''}{fmt(r, c)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Methodology note */}
      <div className="card p-3 bg-blue-50/50 border-blue-100 text-xs text-slate-600 flex gap-2">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p><b>How this is calculated.</b> Budget hours are the fixed inputs from the Engineering Tracker workbook.
            <b> Actual progress</b> is the average Rules-of-Credit progress (25/75/85/100) of each package's documents in the MDDR;
            <b> Plan to date</b> is the share of documents whose planned (due) date is on/before the “As of” date;
            <b> earned hours</b> = current budget × actual %.</p>
          <p><b>Two corrections vs the spreadsheet:</b> “% of Proj” divided by an empty cell (always 0) — fixed to budget-hours share of the grand total;
            “% of Discpl” used document <i>count</i> share — switched to <b>budget-hours</b> share for consistency with the hours basis (toggle “docs” to compare).
            Subtotals are hours-weighted (Σ earned ÷ Σ budget).</p>
        </div>
      </div>
    </div>
  )
}
