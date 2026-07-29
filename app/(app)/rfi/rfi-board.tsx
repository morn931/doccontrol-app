'use client'

import { useMemo, useState } from 'react'
import RfiPopup from './rfi-popup'

// One row per Aconex RFI thread (aconex_rfi), synced daily. Read-only mirror —
// Aconex remains the system of record; this board answers "what's open, whose
// court, how long" without logging into Aconex. All columns are Aconex-sourced
// (register + RFI form) — deliberately NO priority/triage column (that belongs
// to the PDN register's commercial workflow, not RFIs).
export type Rfi = {
  id: string
  thread_id: number
  mail_no: string | null
  corr_type: string | null
  title: string | null
  package_code: string | null
  package_full: string | null
  cause: string | null
  cost_impact: boolean | null
  schedule_impact: boolean | null
  from_org: string | null
  from_user: string | null
  raised_date: string | null
  response_due: string | null
  aconex_status: string | null
  last_mail_date: string | null
  days_silent: number | null
  mail_count: number
  attachment_count: number
  court_who: string | null
  court_people: string | null
  court_side: string | null
  overdue: boolean
  closed: boolean
  summary: string | null
}

type Filter = 'OPEN_PPE' | 'OPEN_OTHER' | 'OVERDUE' | 'CLOSED' | 'ALL'

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const statusChip = (s?: string | null) => {
  switch ((s ?? '').toLowerCase()) {
    case 'outstanding': return 'bg-amber-100 text-amber-800 border-amber-300'
    case 'overdue': return 'bg-red-100 text-red-800 border-red-300'
    case 'partial': return 'bg-sky-100 text-sky-800 border-sky-300'
    case 'responded': return 'bg-emerald-100 text-emerald-800 border-emerald-300'
    case 'closed-out': return 'bg-slate-100 text-slate-600 border-slate-300'
    default: return 'bg-slate-50 text-slate-500 border-slate-200'
  }
}

// Short org labels so the court chip stays readable.
const shortOrg = (org: string) =>
  org
    .replace(/Power Plant Electrical Technologies.*/i, 'PPE')
    .replace(/Siemens Energy.*/i, 'Siemens')
    .replace(/ABB AB/i, 'ABB')

function courtChip(r: Rfi) {
  if (r.closed) return <span className="inline-block rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">Closed-Out</span>
  const who = (r.court_who ?? '').split(',').map((s) => shortOrg(s.trim())).filter(Boolean).join(', ')
  const days = r.days_silent != null ? ` · ${r.days_silent}d` : ''
  if (r.court_side === 'ppe') {
    return <span className="inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800" title={r.court_people ?? ''}>⚠ {who}{days}</span>
  }
  return <span className="inline-block rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-xs text-sky-800" title={r.court_people ?? ''}>⏳ {who}{days}</span>
}

const csvEscape = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function RfiBoard({ rows, syncedAt }: { rows: Rfi[]; syncedAt: string | null }) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [pkg, setPkg] = useState<string>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Rfi | null>(null)

  const packages = useMemo(
    () => [...new Set(rows.map((r) => r.package_code || '—'))].sort(),
    [rows]
  )

  const counts = useMemo(() => ({
    OPEN_PPE: rows.filter((r) => !r.closed && r.court_side === 'ppe').length,
    OPEN_OTHER: rows.filter((r) => !r.closed && r.court_side !== 'ppe').length,
    OVERDUE: rows.filter((r) => !r.closed && r.overdue).length,
    CLOSED: rows.filter((r) => r.closed).length,
    ALL: rows.length,
  }), [rows])

  const filtered = useMemo(() => {
    let out = rows
    if (filter === 'OPEN_PPE') out = out.filter((r) => !r.closed && r.court_side === 'ppe')
    else if (filter === 'OPEN_OTHER') out = out.filter((r) => !r.closed && r.court_side !== 'ppe')
    else if (filter === 'OVERDUE') out = out.filter((r) => !r.closed && r.overdue)
    else if (filter === 'CLOSED') out = out.filter((r) => r.closed)
    if (pkg !== 'all') out = out.filter((r) => (r.package_code || '—') === pkg)
    const needle = q.trim().toLowerCase()
    if (needle) {
      out = out.filter((r) =>
        [r.mail_no, r.title, r.cause, r.from_org, r.court_who, r.summary]
          .some((v) => (v ?? '').toLowerCase().includes(needle))
      )
    }
    // open first, then most-recently-active
    return [...out].sort((a, b) =>
      Number(a.closed) - Number(b.closed) || (b.last_mail_date ?? '').localeCompare(a.last_mail_date ?? ''))
  }, [rows, filter, pkg, q])

  const exportCsv = () => {
    const header = ['RFI No', 'Type', 'Package', 'Title', 'Cause', 'Raised by', 'Raised', 'Response due',
      'Aconex status', 'Cost impact', 'Schedule impact', 'Court', 'Days silent', 'Mails', 'Attachments', 'Summary']
    const lines = filtered.map((r) => [
      r.mail_no, r.corr_type, r.package_code, r.title, r.cause, `${r.from_user ?? ''} (${r.from_org ?? ''})`,
      fmtDate(r.raised_date), fmtDate(r.response_due), r.closed ? 'Closed-Out' : r.aconex_status,
      r.cost_impact == null ? '' : r.cost_impact ? 'Yes' : 'No',
      r.schedule_impact == null ? '' : r.schedule_impact ? 'Yes' : 'No',
      r.closed ? '' : r.court_who, r.days_silent, r.mail_count, r.attachment_count, r.summary,
    ].map(csvEscape).join(','))
    const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'rfi-tracker.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const cards: { key: Filter; label: string; n: number; accent: string }[] = [
    { key: 'OPEN_PPE', label: 'Open — with PPE', n: counts.OPEN_PPE, accent: 'text-amber-600' },
    { key: 'OPEN_OTHER', label: 'Open — waiting on others', n: counts.OPEN_OTHER, accent: 'text-sky-600' },
    { key: 'OVERDUE', label: 'Overdue (Aconex-stamped)', n: counts.OVERDUE, accent: 'text-red-600' },
    { key: 'CLOSED', label: 'Closed out', n: counts.CLOSED, accent: 'text-slate-500' },
    { key: 'ALL', label: 'All RFIs', n: counts.ALL, accent: 'text-navy-700' },
  ]

  return (
    <div>
      {/* summary cards = filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <button key={c.key} onClick={() => setFilter(filter === c.key ? 'ALL' : c.key)}
            className={`card p-4 text-left transition ${filter === c.key ? 'ring-2 ring-navy-400' : 'hover:border-navy-300'}`}>
            <p className={`text-2xl font-bold ${c.accent}`}>{c.n}</p>
            <p className="mt-1 text-xs text-slate-500">{c.label}</p>
          </button>
        ))}
      </div>

      {/* filters row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Package:</span>
        {['all', ...packages].map((p) => (
          <button key={p} onClick={() => setPkg(p)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${pkg === p ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
            {p}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search RFI no, title, cause, org…"
          className="ml-auto w-72 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy-300"
        />
        <button onClick={exportCsv}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          ↓ CSV
        </button>
      </div>

      {/* register table */}
      <div className="card mt-3 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy-700 text-left text-white">
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">RFI No</th>
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">Pkg</th>
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">Title</th>
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">Cause</th>
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">Raised by</th>
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">Raised</th>
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">Resp. due</th>
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">Aconex status</th>
              <th className="border-r border-navy-600 px-3 py-2 text-center font-semibold" title="Cost impact flagged on the RFI form">$</th>
              <th className="border-r border-navy-600 px-3 py-2 text-center font-semibold" title="Schedule impact flagged on the RFI form">🕒</th>
              <th className="border-r border-navy-600 px-3 py-2 font-semibold">Court</th>
              <th className="px-3 py-2 text-center font-semibold" title="Mails / attachments on the thread">✉ / 📎</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 align-top hover:bg-slate-50 ${r.closed ? 'text-slate-400' : ''}`}>
                <td className="whitespace-nowrap px-3 py-2">
                  <button onClick={() => setOpen(r)}
                    className="font-medium text-blue-800 underline underline-offset-2 hover:text-blue-600">
                    {r.mail_no}
                  </button>
                  {r.corr_type && r.corr_type !== 'Request For Information' && (
                    <div className="text-[10px] text-violet-600">{r.corr_type}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2" title={r.package_full ?? ''}>{r.package_code || '—'}</td>
                <td className="min-w-[16rem] px-3 py-2">{r.title}</td>
                <td className="px-3 py-2 text-xs">{r.cause ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs" title={r.from_user ?? ''}>{shortOrg(r.from_org ?? '—')}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtDate(r.raised_date)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtDate(r.response_due)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${statusChip(r.closed ? 'closed-out' : r.aconex_status)}`}>
                    {r.closed ? 'Closed-Out' : r.aconex_status ?? '—'}
                  </span>
                </td>
                <td className="px-3 py-2 text-center text-xs" title={r.cost_impact ? 'Cost impact flagged' : ''}>{r.cost_impact ? '✓' : '—'}</td>
                <td className="px-3 py-2 text-center text-xs" title={r.schedule_impact ? 'Schedule impact flagged' : ''}>{r.schedule_impact ? '✓' : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2">{courtChip(r)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-center text-xs text-slate-500">{r.mail_count} / {r.attachment_count}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-sm text-slate-400">No RFIs match the current filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        Read-only mirror of Aconex RFI correspondence (Request For Information, Technical Query, Design Query threads).
        {syncedAt ? ` Last synced ${new Date(syncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : ''}
        {' '}Refreshes daily at 06:00 with the Aconex scan.
      </p>

      {open && <RfiPopup rfi={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
