'use client'

import { useMemo, useState, useTransition } from 'react'
import CoreTable, { Chip, SearchBox, exportCsv, type CoreColumn } from '@/components/core-table'
import RfiPopup from './rfi-popup'
import { updateRfiResponsible } from './actions'

// One row per Aconex RFI thread (aconex_rfi), synced daily. Read-only mirror —
// Aconex remains the system of record; this board answers "what's open, whose
// court, how long" without logging into Aconex. All columns are Aconex-sourced
// (register + RFI form) except "PPE responsible", which is auto-suggested from
// the thread's PPE participants and hand-editable (edits stick — the sync
// never overwrites a manual name). Deliberately NO priority/triage column.
// Table = the platform CoreTable standard (navy header / teal chips).
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
  ppe_responsible: string | null
  ppe_responsible_manual: boolean
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

// Inline-editable "PPE responsible" cell: click to edit, Enter/blur saves.
// Manual names show a teal dot; clearing the box returns the row to auto.
function ResponsibleCell({ rfi }: { rfi: Rfi }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(rfi.ppe_responsible ?? '')
  const [saved, setSaved] = useState(rfi.ppe_responsible ?? '')
  const [manual, setManual] = useState(rfi.ppe_responsible_manual)
  const [err, setErr] = useState(false)
  const [, startTransition] = useTransition()

  const persist = () => {
    setEditing(false)
    if (value.trim() === saved.trim()) return
    startTransition(async () => {
      const res = await updateRfiResponsible(rfi.id, value)
      if (res.ok) { setSaved(value.trim()); setManual(value.trim().length > 0); setErr(false) }
      else setErr(true)
    })
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={persist}
        onKeyDown={(e) => { if (e.key === 'Enter') persist(); if (e.key === 'Escape') { setValue(saved); setEditing(false) } }}
        placeholder="name… (empty = auto)"
        className="w-full rounded border border-teal-300 px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-300"
      />
    )
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setValue(saved); setEditing(true) }}
      title={manual ? 'Set by hand — click to change (clear to return to auto)' : 'Auto-suggested from the Aconex thread — click to correct'}
      className="group flex w-full items-center gap-1 text-left text-xs hover:text-teal-700"
    >
      <span className={saved ? '' : 'text-slate-300'}>{saved || '—'}</span>
      {manual && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" title="set manually" />}
      <span className="ml-auto text-slate-300 opacity-0 group-hover:opacity-100">✎</span>
      {err && <span className="text-red-500" title="save failed">!</span>}
    </button>
  )
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
        [r.mail_no, r.title, r.cause, r.from_org, r.court_who, r.ppe_responsible, r.summary]
          .some((v) => (v ?? '').toLowerCase().includes(needle))
      )
    }
    return out
  }, [rows, filter, pkg, q])

  const columns: CoreColumn<Rfi>[] = [
    {
      key: 'mail_no', header: 'RFI No', sortValue: (r) => r.mail_no,
      csv: (r) => r.mail_no,
      render: (r) => (
        <div>
          <button onClick={() => setOpen(r)}
            className="font-medium text-blue-800 underline underline-offset-2 hover:text-blue-600">
            {r.mail_no}
          </button>
          {r.corr_type && r.corr_type !== 'Request For Information' && (
            <div className="text-[10px] text-violet-600">{r.corr_type}</div>
          )}
        </div>
      ),
    },
    {
      key: 'pkg', header: 'Pkg', sortValue: (r) => r.package_code ?? '',
      csv: (r) => r.package_code,
      render: (r) => <span title={r.package_full ?? ''}>{r.package_code || '—'}</span>,
    },
    {
      key: 'title', header: 'Title', sortValue: (r) => r.title ?? '',
      csv: (r) => r.title,
      render: (r) => <span className={r.closed ? 'text-slate-400' : ''}>{r.title}</span>,
    },
    {
      key: 'cause', header: 'Cause', sortValue: (r) => r.cause ?? '',
      csv: (r) => r.cause,
      render: (r) => <span className="text-xs">{r.cause ?? '—'}</span>,
    },
    {
      key: 'raised_by', header: 'Raised by', sortValue: (r) => r.from_org ?? '',
      csv: (r) => `${r.from_user ?? ''} (${r.from_org ?? ''})`,
      render: (r) => <span className="text-xs" title={r.from_user ?? ''}>{shortOrg(r.from_org ?? '—')}</span>,
    },
    {
      key: 'raised', header: 'Raised', sortValue: (r) => r.raised_date ?? '',
      csv: (r) => fmtDate(r.raised_date),
      render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.raised_date)}</span>,
    },
    {
      key: 'due', header: 'Resp. due', sortValue: (r) => r.response_due ?? '',
      csv: (r) => fmtDate(r.response_due),
      render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.response_due)}</span>,
    },
    {
      key: 'status', header: 'Aconex status', sortValue: (r) => (r.closed ? 'Closed-Out' : r.aconex_status ?? ''),
      csv: (r) => (r.closed ? 'Closed-Out' : r.aconex_status),
      render: (r) => (
        <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${statusChip(r.closed ? 'closed-out' : r.aconex_status)}`}>
          {r.closed ? 'Closed-Out' : r.aconex_status ?? '—'}
        </span>
      ),
    },
    {
      key: 'cost', header: '$', align: 'center', headerTitle: 'Cost impact flagged on the RFI form',
      sortValue: (r) => (r.cost_impact ? 1 : 0),
      csv: (r) => (r.cost_impact == null ? '' : r.cost_impact ? 'Yes' : 'No'),
      render: (r) => <span className="text-xs">{r.cost_impact ? '✓' : '—'}</span>,
    },
    {
      key: 'sched', header: '🕒', align: 'center', headerTitle: 'Schedule impact flagged on the RFI form',
      sortValue: (r) => (r.schedule_impact ? 1 : 0),
      csv: (r) => (r.schedule_impact == null ? '' : r.schedule_impact ? 'Yes' : 'No'),
      render: (r) => <span className="text-xs">{r.schedule_impact ? '✓' : '—'}</span>,
    },
    {
      key: 'court', header: 'Court', sortValue: (r) => (r.closed ? 'zzz' : `${r.court_side}:${r.court_who ?? ''}`),
      csv: (r) => (r.closed ? '' : r.court_who),
      render: (r) => courtChip(r),
    },
    {
      key: 'responsible', header: 'PPE responsible', headerTitle: 'Auto-suggested from the thread — click a name to correct it',
      sortValue: (r) => r.ppe_responsible ?? '',
      csv: (r) => r.ppe_responsible,
      render: (r) => <ResponsibleCell key={`${r.id}:${r.ppe_responsible ?? ''}`} rfi={r} />,
    },
    {
      key: 'mails', header: '✉ / 📎', align: 'center', headerTitle: 'Mails / attachments on the thread',
      sortValue: (r) => r.mail_count,
      csv: (r) => `${r.mail_count} / ${r.attachment_count}`,
      render: (r) => <span className="text-xs text-slate-500">{r.mail_count} / {r.attachment_count}</span>,
    },
  ]

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
        <Chip active={pkg === 'all'} onClick={() => setPkg('all')}>all</Chip>
        {packages.map((p) => (
          <Chip key={p} active={pkg === p} onClick={() => setPkg(p)}>{p}</Chip>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Search RFI no, title, cause, org…" />
          <button
            onClick={() => exportCsv(
              'rfi-tracker.csv',
              columns.filter((c) => c.csv).map((c) => (typeof c.header === 'string' ? c.header : c.key)),
              filtered.map((r) => columns.filter((c) => c.csv).map((c) => c.csv!(r)))
            )}
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
            ↓ CSV
          </button>
        </div>
      </div>

      <CoreTable<Rfi>
        tableId="rfi-tracker"
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        defaultSort={(a, b) =>
          Number(a.closed) - Number(b.closed) || (b.last_mail_date ?? '').localeCompare(a.last_mail_date ?? '')}
        emptyText="No RFIs match the current filter."
      />

      <p className="mt-2 text-xs text-slate-400">
        Read-only mirror of Aconex RFI correspondence (Request For Information, Technical Query, Design Query threads).
        &quot;PPE responsible&quot; is auto-suggested from the thread — click a name to correct it (a teal dot marks hand-set names; clear the box to return to auto).
        {syncedAt ? ` Last synced ${new Date(syncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : ''}
        {' '}Refreshes daily at 06:00 with the Aconex scan.
      </p>

      {open && <RfiPopup rfi={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
