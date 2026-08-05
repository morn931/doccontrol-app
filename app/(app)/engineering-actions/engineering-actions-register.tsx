'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, MessageSquare, ChevronDown, ChevronRight, X, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

type Reply = { id: string; author_email: string; author_name: string | null; body: string; created_at: string }
type Action = {
  id: string; action_ref: string; document_number: string | null; discipline: string | null
  raised_by_email: string; raised_by_name: string | null; raised_at: string
  assigned_to_email: string | null; assigned_to_name: string | null
  priority: 'low' | 'medium' | 'high' | null
  status: 'open' | 'in_progress' | 'closed' | 'dismissed'
  description: string; source: string; due_date: string | null; suggested: boolean
  closeout_comment: string | null; closed_by_email: string | null; closed_at: string | null
  replies: Reply[]
}
type Me = { email: string; name: string | null }

const PRIO_COLOR: Record<string, string> = { high: 'bg-red-100 text-red-800', medium: 'bg-amber-100 text-amber-800', low: 'bg-slate-100 text-slate-600' }
const STATUS_COLOR: Record<string, string> = { open: 'bg-red-50 text-red-700', in_progress: 'bg-blue-50 text-blue-700', closed: 'bg-emerald-50 text-emerald-700', dismissed: 'bg-slate-100 text-slate-500' }
const nameOf = (e: string | null, n: string | null) => n || (e ? e.split('@')[0] : '—')

export default function EngineeringActionsRegister({ isManager, me }: { isManager: boolean; me: Me }) {
  const [actions, setActions] = useState<Action[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<{ email: string; full_name: string | null }[]>([])
  const [status, setStatus] = useState('open')
  const [assignee, setAssignee] = useState('')
  const [search, setSearch] = useState('')
  const [groupByPerson, setGroupByPerson] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showRaise, setShowRaise] = useState(false)
  const [view, setView] = useState<'register' | 'manager' | 'decisions'>('register')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/engineering-actions')
      if (res.ok) setActions((await res.json()).actions ?? [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { fetch('/api/engineering-actions?assignees=1').then(r => r.json()).then(d => setUsers(d.users ?? [])).catch(() => {}) }, [])

  const suggestedCount = actions.filter(a => a.suggested).length
  const filtered = useMemo(() => actions.filter(a => {
    if (status === 'suggested') { if (!a.suggested) return false }
    else { if (a.suggested) return false; if (status !== 'all' && a.status !== status) return false }
    if (assignee && a.assigned_to_email !== assignee) return false
    if (search) {
      const s = search.toLowerCase()
      if (!(`${a.action_ref} ${a.description} ${a.document_number ?? ''} ${a.discipline ?? ''}`.toLowerCase().includes(s))) return false
    }
    return true
  }), [actions, status, assignee, search])

  const groups = useMemo(() => {
    if (!groupByPerson) return [{ key: '', label: '', rows: filtered }]
    const m: Record<string, Action[]> = {}
    for (const a of filtered) (m[a.assigned_to_email ?? ''] ??= []).push(a)
    return Object.entries(m).sort((x, y) => (x[0] || 'zzz').localeCompare(y[0] || 'zzz'))
      .map(([k, rows]) => ({ key: k, label: nameOf(k, rows[0]?.assigned_to_name ?? null) + ` (${rows.length})`, rows }))
  }, [filtered, groupByPerson])

  const openCount = actions.filter(a => a.status === 'open' || a.status === 'in_progress').length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ClipboardList className="h-6 w-6 text-teal-600" /> Engineering Action Register</h1>
          <p className="text-sm text-slate-500 mt-0.5">Actions raised from design reviews. {openCount} open · {actions.length} total.
            {isManager ? ' You can prioritise, close and delete.' : ' Raise and reply; the Engineering Manager closes.'}</p>
        </div>
        <button onClick={() => setShowRaise(true)} className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">
          <Plus className="h-4 w-4" /> Raise action
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(['register', ...(isManager ? ['manager'] : []), 'decisions'] as ('register' | 'manager' | 'decisions')[]).map(v => (
          <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${view === v ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {v === 'register' ? 'Register' : v === 'manager' ? 'Manager view' : 'Engineering Decisions'}
          </button>
        ))}
      </div>

      {view === 'manager' && isManager ? <ManagerView actions={actions} users={users} onChange={load} />
        : view === 'decisions' ? <DecisionsView isManager={isManager} me={me} users={users} />
        : (
      <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="open">Open</option><option value="in_progress">In progress</option>
          <option value="closed">Closed</option><option value="dismissed">Dismissed</option><option value="all">All statuses</option>
          {suggestedCount > 0 && <option value="suggested">AI-suggested ({suggestedCount})</option>}
        </select>
        {status === 'suggested' && <span className="text-xs text-amber-700">Review AI-picked actions — Confirm to make live, or Dismiss.</span>}
        <select value={assignee} onChange={e => setAssignee(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">All assignees</option>
          {users.map(u => <option key={u.email} value={u.email}>{u.full_name || u.email}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ref / text / doc…" className="rounded-md border border-slate-300 px-2 py-1.5 w-56" />
        <label className="inline-flex items-center gap-1.5 ml-1 text-slate-600"><input type="checkbox" checked={groupByPerson} onChange={e => setGroupByPerson(e.target.checked)} /> Group by engineer</label>
      </div>

      {loading ? <p className="text-sm text-slate-400">Loading…</p> : filtered.length === 0 ? (
        <p className="text-sm text-slate-400">No actions match.</p>
      ) : groups.map(g => (
        <div key={g.key} className="space-y-2">
          {g.label && <p className="text-sm font-semibold text-slate-700 mt-2">{g.label}</p>}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#0B3563] text-white text-left"><tr>
                <th className="px-3 py-2 font-medium">Ref</th><th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Document</th><th className="px-3 py-2 font-medium">Assignee</th>
                <th className="px-3 py-2 font-medium">Priority</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2"></th>
              </tr></thead>
              <tbody>
                {g.rows.map(a => (
                  <Row key={a.id} a={a} isManager={isManager} users={users} expanded={expanded === a.id}
                    onToggle={() => setExpanded(expanded === a.id ? null : a.id)} onChange={load} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      </>
      )}

      {showRaise && <RaiseModal users={users} onClose={() => setShowRaise(false)} onSaved={() => { setShowRaise(false); load() }} />}
    </div>
  )
}

// ── Manager view: per-engineer board (worst-first), this-week stats, drill-in, bulk ──
function ManagerView({ actions, users, onChange }: { actions: Action[]; users: { email: string; full_name: string | null }[]; onChange: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [push, setPush] = useState<Action | null>(null)

  const now = Date.now(), DAY = 86400000, weekAgo = now - 7 * DAY, today = new Date().toISOString().slice(0, 10)
  const isOpen = (a: Action) => (a.status === 'open' || a.status === 'in_progress') && !a.suggested
  const overdue = (a: Action) => isOpen(a) && !!a.due_date && a.due_date < today
  const ageDays = (a: Action) => Math.floor((now - new Date(a.raised_at).getTime()) / DAY)

  const stats = useMemo(() => ({
    raisedThisWeek: actions.filter(a => !a.suggested && new Date(a.raised_at).getTime() >= weekAgo).length,
    closedThisWeek: actions.filter(a => !a.suggested && a.closed_at && new Date(a.closed_at).getTime() >= weekAgo).length,
    stillOpen: actions.filter(isOpen).length,
    overdue: actions.filter(overdue).length,
  }), [actions])

  const board = useMemo(() => {
    const m: Record<string, Action[]> = {}
    for (const a of actions) if (isOpen(a)) (m[a.assigned_to_email ?? '—unassigned—'] ??= []).push(a)
    return Object.entries(m).map(([email, rows]) => ({
      email, name: nameOf(email === '—unassigned—' ? null : email, rows[0]?.assigned_to_name ?? null),
      open: rows.length,
      high: rows.filter(r => r.priority === 'high').length,
      overdue: rows.filter(overdue).length,
      oldest: rows.reduce((mx, r) => Math.max(mx, ageDays(r)), 0),
      rows: rows.sort((x, y) => (Number(overdue(y)) - Number(overdue(x))) || ageDays(y) - ageDays(x)),
    })).sort((x, y) => y.overdue - x.overdue || y.high - x.high || y.oldest - x.oldest)
  }, [actions])

  function toggleSel(id: string) { setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  async function bulk(patch: any) {
    if (!sel.size) return
    setBulkBusy(true)
    await Promise.all([...sel].map(id => fetch(`/api/engineering-actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })))
    setSel(new Set()); setBulkBusy(false); onChange()
  }

  return (
    <div className="space-y-4">
      {/* This-week stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Still open', stats.stillOpen, 'text-slate-900'], ['Overdue', stats.overdue, 'text-red-600'], ['Raised this week', stats.raisedThisWeek, 'text-slate-900'], ['Closed this week', stats.closedThisWeek, 'text-emerald-600']].map(([label, val, cls]) => (
          <div key={label as string} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className={`text-2xl font-semibold ${cls}`}>{val as number}</p></div>
        ))}
      </div>

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center gap-2 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-sm">
          <span className="font-medium text-teal-900">{sel.size} selected</span>
          <select disabled={bulkBusy} onChange={e => e.target.value && bulk({ priority: e.target.value })} className="rounded border border-slate-300 px-2 py-1 text-xs"><option value="">Set priority…</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
          <button disabled={bulkBusy} onClick={() => bulk({ status: 'closed', closeoutComment: 'Bulk-closed in weekly review' })} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Close selected</button>
          <button onClick={() => setSel(new Set())} className="ml-auto text-xs text-slate-500">clear</button>
        </div>
      )}

      {board.length === 0 ? <p className="text-sm text-slate-400">No open actions.</p> : (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0B3563] text-white text-left"><tr>
              <th className="px-3 py-2 font-medium">Engineer</th><th className="px-3 py-2 font-medium text-center">Open</th>
              <th className="px-3 py-2 font-medium text-center">High</th><th className="px-3 py-2 font-medium text-center">Overdue</th>
              <th className="px-3 py-2 font-medium text-center">Oldest</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>
              {board.map(p => (
                <Fragment key={p.email}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(open === p.email ? null : p.email)}>
                    <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                    <td className="px-3 py-2 text-center">{p.open}</td>
                    <td className="px-3 py-2 text-center">{p.high ? <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs">{p.high}</span> : '—'}</td>
                    <td className="px-3 py-2 text-center">{p.overdue ? <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs">{p.overdue}</span> : '—'}</td>
                    <td className="px-3 py-2 text-center text-slate-600">{p.oldest}d</td>
                    <td className="px-3 py-2 text-right">{open === p.email ? <ChevronDown className="h-4 w-4 inline text-slate-400" /> : <ChevronRight className="h-4 w-4 inline text-slate-400" />}</td>
                  </tr>
                  {open === p.email && (
                    <tr><td colSpan={6} className="px-3 py-2 bg-slate-50/60">
                      <table className="w-full text-sm"><tbody>
                        {p.rows.map(a => (
                          <tr key={a.id} className="border-t border-slate-100 align-top">
                            <td className="px-1 py-1.5 w-6"><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggleSel(a.id)} /></td>
                            <td className="px-2 py-1.5 font-mono text-xs text-slate-400 whitespace-nowrap">{a.action_ref}</td>
                            <td className="px-2 py-1.5 text-slate-800">{a.description}<span className="text-xs text-slate-400"> · {ageDays(a)}d old{overdue(a) ? ' · overdue' : ''}</span></td>
                            <td className="px-2 py-1.5">{a.priority ? <span className={`rounded-full px-2 py-0.5 text-xs ${PRIO_COLOR[a.priority]}`}>{a.priority}</span> : '—'}</td>
                            <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs capitalize ${STATUS_COLOR[a.status]}`}>{a.status.replace('_', ' ')}</span></td>
                            <td className="px-2 py-1.5 text-right"><button onClick={() => setPush(a)} className="rounded-md border border-teal-300 px-2 py-0.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 whitespace-nowrap">Push to EDR</button></td>
                          </tr>
                        ))}
                      </tbody></table>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {push && <DecisionModal users={users} title="Push to Engineering Decision Register" sourceActionId={push.id}
        prefill={{ title: push.description.slice(0, 120), background: push.description, discipline: push.discipline, document_number: push.document_number }}
        onClose={() => setPush(null)} onSaved={() => setPush(null)} />}
    </div>
  )
}

// ── Engineering Decision Register (EDR) tab ──────────────────────────────────
type Decision = {
  id: string; decision_ref: string; title: string | null; background: string | null
  discipline: string | null; document_number: string | null
  options_considered: string | null; decision_made: string | null; rationale: string | null
  priority: string | null; cost_impact: string | null; schedule_impact: string | null; safety_impact: string | null
  raised_by_email: string; raised_by_name: string | null; owner_email: string | null; owner_name: string | null
  status: string; approved_by_email: string | null; date_raised: string; date_closed: string | null
  related_documents: string | null; comments: string | null; source_action_id: string | null
}
const DEC_STATUS: Record<string, string> = { pending_approval: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-100 text-red-700', on_hold: 'bg-slate-100 text-slate-600', superseded: 'bg-slate-100 text-slate-500', closed: 'bg-slate-100 text-slate-500' }

function DecisionsView({ isManager, me, users }: { isManager: boolean; me: Me; users: { email: string; full_name: string | null }[] }) {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('pending_approval')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  async function load() { setLoading(true); try { const r = await fetch('/api/engineering-decisions'); if (r.ok) setDecisions((await r.json()).decisions ?? []) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const filtered = decisions.filter(d => status === 'all' || d.status === status)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">The controlled Engineering Decision Register — pushed from actions or entered directly, each with an approval loop. {decisions.filter(d => d.status === 'pending_approval').length} pending approval.</p>
        <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700"><Plus className="h-4 w-4" /> New decision</button>
      </div>
      <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
        <option value="pending_approval">Pending approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        <option value="on_hold">On hold</option><option value="superseded">Superseded</option><option value="closed">Closed</option><option value="all">All</option>
      </select>

      {loading ? <p className="text-sm text-slate-400">Loading…</p> : filtered.length === 0 ? <p className="text-sm text-slate-400">No decisions.</p> : (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0B3563] text-white text-left"><tr>
              <th className="px-3 py-2 font-medium">Ref</th><th className="px-3 py-2 font-medium">Decision</th>
              <th className="px-3 py-2 font-medium">Discipline</th><th className="px-3 py-2 font-medium">Owner/Approver</th>
              <th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>
              {filtered.map(d => <DecisionRow key={d.id} d={d} me={me} isManager={isManager} expanded={expanded === d.id} onToggle={() => setExpanded(expanded === d.id ? null : d.id)} onChange={load} />)}
            </tbody>
          </table>
        </div>
      )}
      {showNew && <DecisionModal users={users} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} />}
    </div>
  )
}

function DecisionRow({ d, me, isManager, expanded, onToggle, onChange }: { d: Decision; me: Me; isManager: boolean; expanded: boolean; onToggle: () => void; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const canApprove = isManager || (d.owner_email && me.email.toLowerCase() === d.owner_email.toLowerCase())
  async function patch(body: any) { setBusy(true); await fetch(`/api/engineering-decisions/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); setBusy(false); onChange() }
  async function del() { if (!confirm(`Delete ${d.decision_ref}?`)) return; setBusy(true); await fetch(`/api/engineering-decisions/${d.id}`, { method: 'DELETE' }); onChange() }
  const F = ({ label, v }: { label: string; v: string | null }) => v ? <p className="text-sm"><span className="text-slate-500">{label}: </span><span className="text-slate-800 whitespace-pre-wrap">{v}</span></p> : null
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50 align-top">
        <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{d.decision_ref}</td>
        <td className="px-3 py-2 text-slate-800 max-w-md"><button onClick={onToggle} className="text-left hover:text-teal-700">{d.title || d.background || '(untitled)'}</button></td>
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{d.discipline ?? '—'}</td>
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{nameOf(d.owner_email, d.owner_name)}</td>
        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs capitalize ${DEC_STATUS[d.status]}`}>{d.status.replace('_', ' ')}</span></td>
        <td className="px-3 py-2 text-right"><button onClick={onToggle} className="text-slate-400 hover:text-teal-600">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/60"><td colSpan={6} className="px-4 py-3 space-y-1">
          <p className="text-xs text-slate-500">Raised {d.date_raised} by {nameOf(d.raised_by_email, d.raised_by_name)}{d.source_action_id ? ' · pushed from an action' : ''}{d.document_number ? ` · ${d.document_number}` : ''}</p>
          <F label="Background" v={d.background} /><F label="Options considered" v={d.options_considered} />
          <F label="Decision" v={d.decision_made} /><F label="Rationale" v={d.rationale} />
          {(d.cost_impact || d.schedule_impact || d.safety_impact || d.priority) && <p className="text-xs text-slate-500">Impact — cost {d.cost_impact ?? '—'} · schedule {d.schedule_impact ?? '—'} · safety {d.safety_impact ?? '—'}{d.priority ? ` · priority ${d.priority}` : ''}</p>}
          <F label="Related documents" v={d.related_documents} />
          {d.approved_by_email && <p className="text-xs text-emerald-700">{d.status} by {d.approved_by_email}{d.date_closed ? ` on ${d.date_closed}` : ''}</p>}
          {canApprove && d.status === 'pending_approval' && (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-200 pt-2">
              <button onClick={() => patch({ status: 'approved' })} disabled={busy} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Approve</button>
              <button onClick={() => patch({ status: 'rejected' })} disabled={busy} className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700">Reject</button>
              <button onClick={() => patch({ status: 'on_hold' })} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-white">On hold</button>
              {isManager && <button onClick={del} disabled={busy} className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 ml-auto">Delete</button>}
            </div>
          )}
          {canApprove && d.status !== 'pending_approval' && isManager && (
            <div className="mt-2 flex gap-2 border-t border-slate-200 pt-2">
              <button onClick={() => patch({ status: 'pending_approval' })} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-white">Reopen</button>
              <button onClick={del} disabled={busy} className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 ml-auto">Delete</button>
            </div>
          )}
        </td></tr>
      )}
    </>
  )
}

// Shared decision form (used for manual "New decision" and "Push to EDR"). `prefill` seeds
// it from an action; `sourceActionId` links it back.
function DecisionModal({ users, onClose, onSaved, prefill, sourceActionId, title = 'New engineering decision' }:
  { users: { email: string; full_name: string | null }[]; onClose: () => void; onSaved: () => void; prefill?: Partial<Decision>; sourceActionId?: string; title?: string }) {
  const [f, setF] = useState<any>({
    title: prefill?.title ?? '', background: prefill?.background ?? '', discipline: prefill?.discipline ?? '',
    documentNumber: prefill?.document_number ?? '', optionsConsidered: '', decisionMade: '', rationale: '',
    ownerEmail: '', priority: '', costImpact: '', scheduleImpact: '', safetyImpact: '', relatedDocuments: '',
  })
  const [saving, setSaving] = useState(false); const [err, setErr] = useState('')
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  async function save() {
    if (!f.title.trim() && !f.background.trim()) { setErr('A title or background is required.'); return }
    setSaving(true); setErr('')
    const res = await fetch('/api/engineering-decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, sourceActionId }) })
    setSaving(false); if (res.ok) onSaved(); else setErr((await res.json().catch(() => ({})))?.error || 'Could not save.')
  }
  const imp = ['', 'none', 'low', 'medium', 'high']
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-bold text-slate-900">{title}</h2><button onClick={onClose}><X className="h-5 w-5 text-slate-400" /></button></div>
        {sourceActionId && <p className="mb-2 text-xs text-teal-700">Pushed from an engineering action — enters the EDR as Pending Approval.</p>}
        <div className="space-y-3 text-sm">
          <div><label className="block text-slate-600 mb-1">Decision title *</label><input value={f.title} onChange={set('title')} className="w-full rounded-md border border-slate-300 p-2" /></div>
          <div><label className="block text-slate-600 mb-1">Description / background</label><textarea value={f.background} onChange={set('background')} rows={2} className="w-full rounded-md border border-slate-300 p-2" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-slate-600 mb-1">Discipline</label><input value={f.discipline} onChange={set('discipline')} className="w-full rounded-md border border-slate-300 p-2" /></div>
            <div><label className="block text-slate-600 mb-1">Document no.</label><input value={f.documentNumber} onChange={set('documentNumber')} className="w-full rounded-md border border-slate-300 p-2" /></div>
          </div>
          <div><label className="block text-slate-600 mb-1">Options considered</label><textarea value={f.optionsConsidered} onChange={set('optionsConsidered')} rows={2} className="w-full rounded-md border border-slate-300 p-2" /></div>
          <div><label className="block text-slate-600 mb-1">Proposed decision</label><textarea value={f.decisionMade} onChange={set('decisionMade')} rows={2} className="w-full rounded-md border border-slate-300 p-2" /></div>
          <div><label className="block text-slate-600 mb-1">Rationale</label><textarea value={f.rationale} onChange={set('rationale')} rows={2} className="w-full rounded-md border border-slate-300 p-2" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-slate-600 mb-1">Decision Owner / Approver</label><select value={f.ownerEmail} onChange={set('ownerEmail')} className="w-full rounded-md border border-slate-300 p-2"><option value="">—</option>{users.map(u => <option key={u.email} value={u.email}>{u.full_name || u.email}</option>)}</select></div>
            <div><label className="block text-slate-600 mb-1">Priority</label><select value={f.priority} onChange={set('priority')} className="w-full rounded-md border border-slate-300 p-2"><option value="">—</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(['costImpact', 'scheduleImpact', 'safetyImpact'] as const).map(k => (
              <div key={k}><label className="block text-slate-600 mb-1 capitalize">{k.replace('Impact', '')} impact</label><select value={f[k]} onChange={set(k)} className="w-full rounded-md border border-slate-300 p-2">{imp.map(x => <option key={x} value={x}>{x || '—'}</option>)}</select></div>
            ))}
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{saving ? 'Saving…' : 'Submit for approval'}</button>
        </div>
      </div>
    </div>
  )
}

function Row({ a, isManager, users, expanded, onToggle, onChange }: { a: Action; isManager: boolean; users: { email: string; full_name: string | null }[]; expanded: boolean; onToggle: () => void; onChange: () => void }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [closeComment, setCloseComment] = useState('')
  const [closing, setClosing] = useState(false)
  const [showPush, setShowPush] = useState(false)

  async function patch(body: any) { setBusy(true); await fetch(`/api/engineering-actions/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); setBusy(false); onChange() }
  async function sendReply() { if (!reply.trim()) return; setBusy(true); await fetch(`/api/engineering-actions/${a.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply.trim() }) }); setReply(''); setBusy(false); onChange() }
  async function del() { if (!confirm(`Delete ${a.action_ref}? This cannot be undone.`)) return; setBusy(true); await fetch(`/api/engineering-actions/${a.id}`, { method: 'DELETE' }); onChange() }

  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50 align-top">
        <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{a.action_ref}</td>
        <td className="px-3 py-2 text-slate-800 max-w-md">
          <button onClick={onToggle} className="text-left hover:text-teal-700">{a.description}</button>
          <span className="ml-1 text-xs text-slate-400">· {nameOf(a.raised_by_email, a.raised_by_name)}{a.replies.length ? ` · ${a.replies.length} repl${a.replies.length === 1 ? 'y' : 'ies'}` : ''}</span>
        </td>
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{a.document_number ?? '—'}</td>
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{nameOf(a.assigned_to_email, a.assigned_to_name)}</td>
        <td className="px-3 py-2">
          {isManager ? (
            <select value={a.priority ?? ''} disabled={busy} onChange={e => patch({ priority: e.target.value || null })} className="rounded border border-slate-200 text-xs px-1 py-0.5">
              <option value="">—</option><option value="low">Low</option><option value="medium">Med</option><option value="high">High</option>
            </select>
          ) : a.priority ? <span className={`rounded-full px-2 py-0.5 text-xs ${PRIO_COLOR[a.priority]}`}>{a.priority}</span> : '—'}
        </td>
        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs capitalize ${STATUS_COLOR[a.status]}`}>{a.status.replace('_', ' ')}</span></td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button onClick={onToggle} className="text-slate-400 hover:text-teal-600">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/60"><td colSpan={7} className="px-4 py-3">
          {a.suggested && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
              <span className="text-xs font-semibold text-amber-800">AI-suggested from {a.source.replace('_', ' ')} — not yet live</span>
              {isManager && <>
                <button onClick={() => patch({ suggested: false })} disabled={busy} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Confirm → live</button>
                <button onClick={() => patch({ status: 'dismissed' })} disabled={busy} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-white">Dismiss</button>
              </>}
            </div>
          )}
          {a.discipline && <p className="text-xs text-slate-500 mb-2">Discipline: {a.discipline} · Raised {format(new Date(a.raised_at), 'd MMM yyyy')} · via {a.source.replace('_', ' ')}</p>}
          {/* Reply thread */}
          <div className="space-y-1.5">
            {a.replies.map(r => (
              <div key={r.id} className="text-sm"><span className="font-medium text-slate-800">{nameOf(r.author_email, r.author_name)}</span>
                <span className="text-xs text-slate-400"> · {format(new Date(r.created_at), 'd MMM')}</span>
                <span className="block whitespace-pre-wrap text-slate-700">{r.body}</span></div>
            ))}
            {a.closeout_comment && <p className="text-sm text-emerald-700 border-l-2 border-emerald-400 pl-2">Closeout: {a.closeout_comment}</p>}
          </div>
          {a.status !== 'closed' && a.status !== 'dismissed' && (
            <div className="mt-2 flex gap-2">
              <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply / answer…" className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" onKeyDown={e => e.key === 'Enter' && sendReply()} />
              <button onClick={sendReply} disabled={busy || !reply.trim()} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><MessageSquare className="h-3.5 w-3.5" /> Reply</button>
            </div>
          )}
          {/* Push to the Engineering Decision Register (any engineer) */}
          <div className="mt-2">
            <button onClick={() => setShowPush(true)} className="inline-flex items-center gap-1 rounded-md border border-teal-300 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50"><ClipboardList className="h-3.5 w-3.5" /> Push to EDR</button>
          </div>
          {showPush && <DecisionModal users={users} title="Push to Engineering Decision Register" sourceActionId={a.id}
            prefill={{ title: a.description.slice(0, 120), background: a.description, discipline: a.discipline, document_number: a.document_number }}
            onClose={() => setShowPush(false)} onSaved={() => setShowPush(false)} />}
          {/* EM controls */}
          {isManager && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
              {a.status === 'open' && <button onClick={() => patch({ status: 'in_progress' })} disabled={busy} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-white">Mark in progress</button>}
              {a.status !== 'closed' && (closing ? (
                <span className="inline-flex items-center gap-1">
                  <input value={closeComment} onChange={e => setCloseComment(e.target.value)} placeholder="Closeout comment…" className="rounded-md border border-slate-300 px-2 py-1 text-xs w-56" />
                  <button onClick={() => patch({ status: 'closed', closeoutComment: closeComment })} disabled={busy} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Close</button>
                  <button onClick={() => setClosing(false)} className="text-xs text-slate-400">cancel</button>
                </span>
              ) : <button onClick={() => setClosing(true)} disabled={busy} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Close with comment</button>)}
              {a.status !== 'dismissed' && a.status !== 'closed' && <button onClick={() => patch({ status: 'dismissed', closeoutComment: 'Not relevant' })} disabled={busy} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-white">Dismiss</button>}
              <button onClick={del} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 ml-auto"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            </div>
          )}
        </td></tr>
      )}
    </>
  )
}

function RaiseModal({ users, onClose, onSaved }: { users: { email: string; full_name: string | null }[]; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [assignedToEmail, setAssignedToEmail] = useState('')
  const [priority, setPriority] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!description.trim()) return
    setSaving(true); setErr('')
    const u = users.find(x => x.email === assignedToEmail)
    const res = await fetch('/api/engineering-actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description.trim(), documentNumber: documentNumber.trim() || undefined, discipline: discipline.trim() || undefined, assignedToEmail: assignedToEmail || undefined, assignedToName: u?.full_name || undefined, priority: priority || undefined }),
    })
    setSaving(false)
    if (res.ok) onSaved(); else setErr((await res.json().catch(() => ({})))?.error || 'Could not save.')
  }
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-bold text-slate-900">Raise engineering action</h2><button onClick={onClose}><X className="h-5 w-5 text-slate-400" /></button></div>
        <div className="space-y-3 text-sm">
          <div><label className="block text-slate-600 mb-1">Action *</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} autoFocus className="w-full rounded-md border border-slate-300 p-2" placeholder="What needs to be done / resolved…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-slate-600 mb-1">Document no.</label><input value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} className="w-full rounded-md border border-slate-300 p-2" /></div>
            <div><label className="block text-slate-600 mb-1">Discipline</label><input value={discipline} onChange={e => setDiscipline(e.target.value)} className="w-full rounded-md border border-slate-300 p-2" placeholder="e.g. Electrical" /></div>
            <div><label className="block text-slate-600 mb-1">Assign to (follow-up / close)</label><select value={assignedToEmail} onChange={e => setAssignedToEmail(e.target.value)} className="w-full rounded-md border border-slate-300 p-2"><option value="">—</option>{users.map(u => <option key={u.email} value={u.email}>{u.full_name || u.email}</option>)}</select></div>
            <div><label className="block text-slate-600 mb-1">Priority (optional)</label><select value={priority} onChange={e => setPriority(e.target.value)} className="w-full rounded-md border border-slate-300 p-2"><option value="">—</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={saving || !description.trim()} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{saving ? 'Saving…' : 'Log action'}</button>
        </div>
      </div>
    </div>
  )
}
