'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileDown } from 'lucide-react'
import { STATUS_LABEL, STATUS_CLS, STATUS_ORDER, fromLabel, type PrelimStatus } from '@/lib/prelim/status'

export type StatusRow = {
  id: string; session_id: string; session: string; document_number: string | null; revision: string | null; title: string | null; discipline: string | null
  status: PrelimStatus; commentCount: number; unsavedMarks: boolean; markup_committed_at: string | null; outcome: string
  routing: string | null; routing_at: string | null; routing_by_email: string | null; routing_to_email: string | null; routing_to_name: string | null; routing_mailed_at: string | null
  returned_at: string | null; returned_by_email: string | null; returned_from: string | null
  quality_open: number | null; quality_checked_at: string | null; handed_over_batch_id: string | null; tender_stamped_file_url?: string | null
}

const when = (s: string | null) => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

/** One line saying what the status rests on — who, where, when. */
export function statusDetail(d: StatusRow): string {
  switch (d.status) {
    case 'ready_for_tender':    return `${d.routing_by_email ?? ''} · ${when(d.routing_at)}`
    case 'sent_drawing_office':
    case 'sent_document_control':
    case 'sent_lead':           return `${d.routing_mailed_at ? '→' : 'mail failed →'} ${d.routing_to_name ?? d.routing_to_email ?? ''} · ${when(d.routing_at)}`
    case 'returned':            return `from ${fromLabel(d.returned_from)} · ${d.returned_by_email ?? ''} · ${when(d.returned_at)}`
    case 'in_review':           return [d.commentCount ? `${d.commentCount} comment${d.commentCount === 1 ? '' : 's'}` : null, d.unsavedMarks ? 'unsaved marks' : null, d.markup_committed_at ? `marks saved ${when(d.markup_committed_at)}` : null, d.outcome !== 'pending' ? `room: ${d.outcome}` : null].filter(Boolean).join(' · ')
    default:                    return ''
  }
}

export default function StatusView({ docs }: { docs: StatusRow[] }) {
  const [filter, setFilter] = useState<PrelimStatus | 'all'>('all')
  const [session, setSession] = useState('all')
  const [q, setQ] = useState('')
  const sessions = useMemo(() => [...new Set(docs.map(d => d.session))].sort(), [docs])
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const d of docs) c[d.status] = (c[d.status] ?? 0) + 1; return c }, [docs])
  const shown = docs.filter(d => (filter === 'all' || d.status === filter) && (session === 'all' || d.session === session) && (!q || `${d.document_number ?? ''} ${d.title ?? ''}`.toLowerCase().includes(q.toLowerCase())))

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Document', 'Rev', 'Title', 'Discipline', 'Session', 'Status', 'Detail', 'Quality open'].map(esc).join(',')]
    for (const d of shown) lines.push([d.document_number ?? '', d.revision ?? '', d.title ?? '', d.discipline ?? '', d.session, STATUS_LABEL[d.status], statusDetail(d), d.quality_open ?? ''].map(esc).join(','))
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Prelim - current document status.csv'; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      <Link href="/prelim" className="btn-secondary text-xs py-1.5 px-3 w-fit"><ArrowLeft className="h-3.5 w-3.5" /> Prelim Review</Link>
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Current Document Status</h1>
            <p className="text-sm text-slate-500 mt-1">Every drawing in every open session, and where it is right now. Read live — nothing is typed here.</p>
          </div>
          <button onClick={exportCsv} className="btn-secondary text-xs"><FileDown className="h-3.5 w-3.5" /> Export list</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => setFilter('all')} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === 'all' ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>All {docs.length}</button>
          {STATUS_ORDER.map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === s ? 'border-slate-700 ring-2 ring-slate-300 ' + STATUS_CLS[s] : 'border-transparent ' + STATUS_CLS[s] + ' opacity-80 hover:opacity-100'}`}>
              {STATUS_LABEL[s]} {counts[s] ?? 0}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <select className="input w-auto text-xs py-1" value={session} onChange={e => setSession(e.target.value)}>
            <option value="all">All sessions</option>
            {sessions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="input w-72 text-xs py-1" placeholder="Find a document number or title" value={q} onChange={e => setQ(e.target.value)} />
          <span className="text-xs text-slate-500">{shown.length} shown</span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-2">Document</th><th className="px-4 py-2">Title</th><th className="px-4 py-2">Session</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Detail</th><th className="px-4 py-2">Quality</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td colSpan={7} className="px-4 py-8 text-sm text-slate-400">Nothing matches.</td></tr>}
              {shown.map(d => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Link href={`/prelim/${d.session_id}/doc/${d.id}`} className="font-mono text-xs font-medium text-[#0B3563] underline decoration-teal-500 decoration-1 underline-offset-2 hover:text-teal-700">{d.document_number ?? d.title}</Link>
                    {d.revision && <span className="ml-1 text-xs text-slate-400">rev {d.revision}</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-700 max-w-md truncate" title={d.title ?? ''}>{d.title}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{d.session.replace(/ — .*$/, '')}</td>
                  <td className="px-4 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CLS[d.status]}`}>{STATUS_LABEL[d.status]}</span></td>
                  <td className="px-4 py-2 text-xs text-slate-500">{statusDetail(d)}{d.status === 'ready_for_tender' && d.tender_stamped_file_url && <> · <a href={d.tender_stamped_file_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">stamped copy ↗</a></>}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-xs">{!d.quality_checked_at ? <span className="text-slate-300">not checked</span> : (d.quality_open ?? 0) > 0 ? <span className="text-amber-700">{d.quality_open} open</span> : <span className="text-emerald-700">clear</span>}</td>
                  <td className="px-4 py-2 text-right"><Link href={`/prelim/${d.session_id}/doc/${d.id}`} className="btn-secondary text-xs py-1 px-2.5">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
