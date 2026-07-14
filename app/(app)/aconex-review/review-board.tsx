'use client'
import { useMemo, useState } from 'react'

export type ReviewRow = {
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
}

const COURT = {
  RDMC:            { label: 'RDMC — awaiting review', chip: 'bg-amber-100 text-amber-800 border-amber-200' },
  PPE:             { label: 'PPE — our action',       chip: 'bg-rose-100 text-rose-800 border-rose-200' },
  CLOSED:          { label: 'Closed',                 chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  NOT_TRANSMITTED: { label: 'Not transmitted',        chip: 'bg-purple-100 text-purple-800 border-purple-200' },
  UNKNOWN:         { label: 'Unknown',                chip: 'bg-slate-100 text-slate-500 border-slate-200' },
} as const

type CourtKey = keyof typeof COURT

export function ReviewBoard({ rows }: { rows: ReviewRow[] }) {
  const [filter, setFilter] = useState<'ALL' | CourtKey>('ALL')
  const [q, setQ] = useState('')

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length }
    for (const r of rows) c[r.court] = (c[r.court] ?? 0) + 1
    return c
  }, [rows])

  const overdue = useMemo(() => rows.filter(r => r.overdue).length, [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (filter !== 'ALL' && r.court !== filter) return false
      if (needle && !(`${r.docno} ${r.title ?? ''} ${r.discipline ?? ''}`.toLowerCase().includes(needle)))
        return false
      return true
    })
  }, [rows, filter, q])

  const cards: Array<{ key: 'ALL' | CourtKey; label: string; n: number; accent: string }> = [
    { key: 'ALL',    label: 'All documents',       n: counts.ALL ?? 0,       accent: 'text-navy-700' },
    { key: 'RDMC',   label: 'Awaiting RDMC review', n: counts.RDMC ?? 0,     accent: 'text-amber-700' },
    { key: 'PPE',    label: 'PPE action needed',    n: counts.PPE ?? 0,      accent: 'text-rose-700' },
    { key: 'CLOSED', label: 'Closed',               n: counts.CLOSED ?? 0,   accent: 'text-slate-600' },
  ]

  return (
    <div className="space-y-4">
      {/* Summary cards double as court filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
            Clear filter ({COURT[filter].label})
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
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Disc.</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Rev</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Review status</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Whose court</th>
              <th className="px-3 py-2 font-semibold text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const c = COURT[(r.court as CourtKey)] ?? COURT.UNKNOWN
              return (
                <tr key={r.docno + i} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">{r.docno}</td>
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
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.days_in_court ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
