'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Boxes, Loader2, Download, RefreshCw, ArrowLeft, Info } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { WbsRow } from '@/lib/reporting/phase1-wbs'

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

function Bar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full',
          pct >= 100 ? 'bg-emerald-500' : pct >= 67 ? 'bg-teal-500' : pct >= 33 ? 'bg-amber-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-200')}
          style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-medium w-11 text-right tabular-nums">{fmtPct(value)}</span>
    </div>
  )
}

export default function Phase1DeliverablesPage() {
  const [rows, setRows]   = useState<WbsRow[]>([])
  const [total, setTotal] = useState<WbsRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')
  const [selWbs, setSelWbs] = useState('ALL')

  function load() {
    setLoading(true); setError(null)
    fetch('/api/reporting/phase1-deliverables')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setRows([]); setTotal(null) }
        else { setRows(d.rows ?? []); setTotal(d.total ?? null); setGeneratedAt(d.generatedAt ?? '') }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const viewRows = selWbs === 'ALL' ? rows : rows.filter(r => r.wbs === selWbs)

  function exportCSV() {
    const header = ['WBS', 'Description', 'Total Docs', 'Placeholders', 'Active Docs', 'Overall Completion %', 'Completion % (excl. placeholders)']
    const out = [...viewRows, ...(selWbs === 'ALL' && total ? [total] : [])].map(r => [
      r.wbs, r.name, r.totalDocs, r.placeholders, r.activeDocs,
      (r.completionOverall * 100).toFixed(1) + '%', (r.completionExclPlace * 100).toFixed(1) + '%',
    ])
    const csv = [header, ...out].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `Phase1-Engineering-Deliverables-${selWbs}.csv`
    a.click()
  }

  function row(r: WbsRow, heavy = false) {
    return (
      <tr key={r.wbs} className={cn('group', heavy ? 'bg-slate-100 font-semibold' : 'hover:bg-amber-50')}>
        <td style={{ position: 'sticky', left: 0 }}
          className={cn('border-b border-r border-slate-200 px-3 py-2 whitespace-nowrap',
            heavy ? 'bg-slate-100' : 'bg-white group-hover:bg-amber-50')}>
          <span className="font-semibold text-slate-800">{r.wbs}</span>
          {r.name && <span className="text-slate-500"> — {r.name}</span>}
        </td>
        <td className="border-b border-slate-100 px-3 py-2 text-right tabular-nums">{r.totalDocs.toLocaleString()}</td>
        <td className="border-b border-slate-100 px-3 py-2 text-right tabular-nums text-slate-500">{r.placeholders.toLocaleString()}</td>
        <td className="border-b border-slate-100 px-3 py-2 text-right tabular-nums">{r.activeDocs.toLocaleString()}</td>
        <td className="border-b border-slate-100 px-3 py-2"><Bar value={r.completionOverall} /></td>
        <td className="border-b border-slate-100 px-3 py-2"><Bar value={r.completionExclPlace} /></td>
      </tr>
    )
  }

  return (
    <div className="space-y-4 flex flex-col h-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reporting" className="text-xs text-slate-400 hover:text-navy-600 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Reporting
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Boxes className="h-6 w-6 text-navy-600" /> PPE Phase 1 Engineering Deliverables
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            By WBS code · PPE CDDL only · 3-milestone completion (Rev A / Rev 0 / Approved)
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

      {/* WBS filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">WBS:</span>
        {['ALL', ...rows.map(r => r.wbs)].map(w => (
          <button key={w} onClick={() => setSelWbs(w)}
            className={cn('px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
              selWbs === w ? 'bg-navy-700 text-white border-navy-700'
                : 'bg-white text-slate-600 border-slate-300 hover:border-navy-400 hover:text-navy-700')}>
            {w}
          </button>
        ))}
      </div>

      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}

      <div className="card overflow-auto max-h-[calc(100vh-18rem)]">
        <table className="text-xs border-separate border-spacing-0 min-w-full">
          <thead className="sticky top-0 z-20">
            <tr>
              <th style={{ position: 'sticky', left: 0, minWidth: 320 }}
                className="z-30 bg-navy-50 border-b border-r border-slate-200 px-3 py-2 text-left font-bold text-slate-700">WBS</th>
              <th className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-500">Total Docs</th>
              <th className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-500">Placeholders</th>
              <th className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-500">Active Docs</th>
              <th className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-500 min-w-[150px]">Overall Completion %</th>
              <th className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-500 min-w-[150px]">Completion % (excl. placeholders)</th>
            </tr>
          </thead>
          <tbody>
            {viewRows.map(r => row(r))}
            {selWbs === 'ALL' && total && row(total, true)}
          </tbody>
        </table>
      </div>

      <div className="card p-3 bg-blue-50/50 border-blue-100 text-xs text-slate-600 flex gap-2">
        <Info className="h-4 w-4 text-teal-500 shrink-0 mt-0.5" />
        <p>
          Grouped by the CDDL <b>Area / WBS No.</b>, PPE CDDL deliverables only. Each document earns the
          tracker's 3 milestones (Rev A submitted · Rev 0 submitted · Approved), 1/3 each, derived from its
          Aconex status (IFR/IFD/IFC/IFU), Rev A / Rev 0 transmittal dates and revision.
          <b> Placeholders</b> ("RES - Reserved Placeholder" / "No Placeholder Yet") count as 0%.
          <b> Overall Completion %</b> averages over all docs; <b>excl. placeholders</b> averages over started docs only.
        </p>
      </div>
    </div>
  )
}
