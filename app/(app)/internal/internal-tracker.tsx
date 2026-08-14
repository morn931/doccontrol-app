'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Search, ArrowRight, AlertTriangle } from 'lucide-react'

export type TrackerRow = {
  id: string
  docNo: string
  title: string | null
  revision: string | null
  source: string
  stageKey: string
  stageLabel: string
  holder: string
  holderMeta: string | null
  overdue: boolean
  note: string | null
  action: string
  daysInStage: number
}

// Stage groups the DC filters by — order = the lifecycle.
const STAGES: { key: string; label: string }[] = [
  { key: 'setup', label: 'Setup' },
  { key: 'in_review', label: 'In review' },
  { key: 'awaiting_signoff', label: 'Review complete' },
  { key: 'in_signoff', label: 'In sign-off' },
  { key: 'declined', label: 'Declined' },
  { key: 'signed', label: 'Signed' },
  { key: 'issued', label: 'Issued' },
]

const CHIP: Record<string, string> = {
  setup: 'bg-slate-100 text-slate-700',
  in_review: 'bg-amber-100 text-amber-800',
  awaiting_signoff: 'bg-sky-100 text-sky-800',
  in_signoff: 'bg-violet-100 text-violet-800',
  declined: 'bg-red-100 text-red-700',
  signed: 'bg-emerald-100 text-emerald-800',
  issued: 'bg-slate-100 text-slate-500',
  other: 'bg-slate-100 text-slate-600',
}

export default function InternalTracker({ rows }: { rows: TrackerRow[] }) {
  const [q, setQ] = useState('')
  const [stage, setStage] = useState<string>('open')   // 'open' = anything still needing action

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.stageKey] = (c[r.stageKey] ?? 0) + 1
    return c
  }, [rows])
  const openCount = rows.filter(r => !['signed', 'issued'].includes(r.stageKey)).length

  const filtered = useMemo(() => rows.filter(r => {
    if (stage === 'open') { if (['signed', 'issued'].includes(r.stageKey)) return false }
    else if (stage !== 'all') { if (r.stageKey !== stage) return false }
    const needle = q.trim().toLowerCase()
    if (needle) {
      const hay = `${r.docNo} ${r.title ?? ''} ${r.holder}`.toLowerCase()
      if (!needle.split(/\s+/).every(t => hay.includes(t))) return false
    }
    return true
  }).sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.daysInStage - a.daysInStage), [rows, q, stage])

  const Chip = ({ k, label, n }: { k: string; label: string; n: number }) => (
    <button onClick={() => setStage(k)}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
        stage === k ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
      {label}{n != null ? <span className="ml-1 text-slate-400">{n}</span> : null}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ClipboardList className="h-6 w-6 text-teal-600" /> Internal Document Tracker</h1>
          <p className="text-sm text-slate-500 mt-0.5">Where every internal document is right now, who holds it, and who to chase. {openCount} in progress · {rows.length} total.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip k="open" label="In progress" n={openCount} />
        <Chip k="all" label="All" n={rows.length} />
        <span className="w-px h-5 bg-slate-200 mx-1" />
        {STAGES.map(s => (counts[s.key] ? <Chip key={s.key} k={s.key} label={s.label} n={counts[s.key]} /> : null))}
        <div className="relative ml-auto">
          <Search className="h-4 w-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number / title / person…"
            className="rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-sm w-64" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">No internal documents match.</p>
      ) : (
        <div className="rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0B3563] text-white text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Document</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium">With whom</th>
                <th className="px-3 py-2 font-medium">In stage</th>
                <th className="px-3 py-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(r => (
                <tr key={r.id} className={`hover:bg-slate-50 ${r.overdue ? 'bg-red-50/40' : ''}`}>
                  <td className="px-3 py-2.5 align-top">
                    <Link href={`/batches/${r.id}`} className="font-mono text-xs font-semibold text-slate-800 hover:text-teal-700 hover:underline">{r.docNo}</Link>
                    {r.revision != null && <span className="ml-1 text-[11px] text-slate-400">Rev {r.revision}</span>}
                    {r.title && <div className="text-[11px] text-slate-500 truncate max-w-xs">{r.title}</div>}
                    {r.note && <div className="text-[11px] text-red-600 mt-0.5">“{r.note}”</div>}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CHIP[r.stageKey] ?? CHIP.other}`}>{r.stageLabel}</span>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="text-slate-800">{r.holder}</div>
                    {r.holderMeta && <div className="text-[11px] text-slate-400">{r.holderMeta}</div>}
                  </td>
                  <td className="px-3 py-2.5 align-top whitespace-nowrap">
                    <span className={r.overdue ? 'text-red-700 font-semibold inline-flex items-center gap-1' : 'text-slate-600'}>
                      {r.overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                      {r.daysInStage} day{r.daysInStage === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {r.action && r.action !== '—' ? (
                      <Link href={`/batches/${r.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline">
                        {r.action} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
