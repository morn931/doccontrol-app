'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Network, Loader2, Download, RefreshCw, ArrowLeft, Info } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { P6Activity } from '@/lib/reporting/p6-export'

function Bar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2 min-w-[130px]">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-teal-500' : pct > 0 ? 'bg-amber-500' : 'bg-gray-200')}
          style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-medium w-11 text-right tabular-nums">{(value * 100).toFixed(1)}%</span>
    </div>
  )
}

export default function P6ExportPage() {
  const [rows, setRows] = useState<P6Activity[]>([])
  const [total, setTotal] = useState<{ activities: number; docCount: number; avgProgressPct: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')
  const [packages, setPackages] = useState<string[]>([])
  const [selPackage, setSelPackage] = useState('ALL')

  useEffect(() => {
    fetch('/api/mddr/meta?awarded=true').then(r => r.json()).then(d => setPackages(d.packages ?? [])).catch(() => {})
  }, [])

  function load() {
    setLoading(true); setError(null)
    const u = selPackage === 'ALL' ? '/api/reporting/p6-export' : `/api/reporting/p6-export?package=${encodeURIComponent(selPackage)}`
    fetch(u).then(r => r.json()).then(d => {
      if (d.error) { setError(d.error); setRows([]); setTotal(null) }
      else { setRows(d.rows ?? []); setTotal(d.total ?? null); setGeneratedAt(d.generatedAt ?? '') }
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(load, [selPackage])

  // P6-ready CSV: Activity ID + Physical % Complete (0-100), plus context columns.
  function exportP6() {
    const header = ['Activity ID', 'Physical % Complete', 'Document Count', 'Completed Docs', 'Packages']
    const out = rows.map(r => [
      r.activityId, (r.avgProgressPct * 100).toFixed(1), r.docCount, r.completedDocs, r.packages.join(' '),
    ])
    const csv = [header, ...out].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `P6-Progress-${selPackage}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="space-y-4 flex flex-col h-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reporting" className="text-xs text-gray-400 hover:text-navy-600 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Reporting
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Network className="h-6 w-6 text-navy-600" /> P6 Activity-ID Progress Export
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Physical % complete per P6 Activity ID (rolled up from document progress)
            {generatedAt && ` · generated ${new Date(generatedAt).toLocaleString()}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          <button onClick={exportP6} disabled={!rows.length} className="btn-primary text-xs py-1.5 px-3"><Download className="h-3.5 w-3.5" /> Export for P6 (CSV)</button>
          <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh</button>
        </div>
      </div>

      {total && (
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          <div className="card px-4 py-3"><p className="text-xs text-gray-500">Activities</p><p className="text-xl font-bold">{total.activities.toLocaleString()}</p></div>
          <div className="card px-4 py-3"><p className="text-xs text-gray-500">Documents</p><p className="text-xl font-bold">{total.docCount.toLocaleString()}</p></div>
          <div className="card px-4 py-3"><p className="text-xs text-gray-500">Avg % complete</p><p className="text-xl font-bold">{(total.avgProgressPct * 100).toFixed(1)}%</p></div>
        </div>
      )}

      {/* Package filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Package:</span>
        {['ALL', ...packages].map(p => (
          <button key={p} onClick={() => setSelPackage(p)}
            className={cn('px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
              selPackage === p ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-gray-600 border-gray-300 hover:border-navy-400 hover:text-navy-700')}>
            {p}
          </button>
        ))}
      </div>

      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}

      <div className="card overflow-auto max-h-[calc(100vh-22rem)]">
        <table className="text-xs border-separate border-spacing-0 min-w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Activity ID</th>
              <th className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-right font-semibold text-gray-600">Docs</th>
              <th className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-right font-semibold text-gray-600">Completed</th>
              <th className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600 min-w-[160px]">Physical % Complete</th>
              <th className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Packages</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.activityId} className="hover:bg-gray-50">
                <td className="border-b border-gray-50 px-3 py-1.5 font-mono font-medium text-gray-800">{r.activityId}</td>
                <td className="border-b border-gray-50 px-3 py-1.5 text-right tabular-nums">{r.docCount}</td>
                <td className="border-b border-gray-50 px-3 py-1.5 text-right tabular-nums text-gray-500">{r.completedDocs}</td>
                <td className="border-b border-gray-50 px-3 py-1.5"><Bar value={r.avgProgressPct} /></td>
                <td className="border-b border-gray-50 px-3 py-1.5 text-gray-500">{r.packages.join(', ')}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-3 py-12 text-center text-gray-400">No Activity IDs found{selPackage !== 'ALL' ? ` for ${selPackage}` : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-3 bg-blue-50/50 border-blue-100 text-xs text-gray-600 flex gap-2">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <p>
          Each P6 <b>Activity ID</b> rolls up the Rules-of-Credit progress of all MDDR documents
          linked to it (Physical % Complete = average of those documents&apos; progress). The
          <b> Export for P6 (CSV)</b> gives <span className="font-mono">Activity ID, Physical % Complete</span>
          for direct update of the master P6 schedule. Activity IDs currently come from the PPE CDDL (K124);
          vendor packages populate as their registers add them.
        </p>
      </div>
    </div>
  )
}
