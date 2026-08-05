'use client'

import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, MessageSquare, ChevronDown, ChevronRight, X, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

type Reply = { id: string; author_email: string; author_name: string | null; body: string; created_at: string }
type Action = {
  id: string; action_ref: string; document_number: string | null; discipline: string | null
  raised_by_email: string; raised_by_name: string | null; raised_at: string
  assigned_to_email: string | null; assigned_to_name: string | null
  priority: 'low' | 'medium' | 'high' | null
  status: 'open' | 'in_progress' | 'closed' | 'dismissed'
  description: string; source: string; due_date: string | null
  closeout_comment: string | null; closed_by_email: string | null
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

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/engineering-actions')
      if (res.ok) setActions((await res.json()).actions ?? [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { fetch('/api/engineering-actions?assignees=1').then(r => r.json()).then(d => setUsers(d.users ?? [])).catch(() => {}) }, [])

  const filtered = useMemo(() => actions.filter(a => {
    if (status !== 'all' && a.status !== status) return false
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="open">Open</option><option value="in_progress">In progress</option>
          <option value="closed">Closed</option><option value="dismissed">Dismissed</option><option value="all">All statuses</option>
        </select>
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
                  <Row key={a.id} a={a} isManager={isManager} expanded={expanded === a.id}
                    onToggle={() => setExpanded(expanded === a.id ? null : a.id)} onChange={load} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {showRaise && <RaiseModal users={users} onClose={() => setShowRaise(false)} onSaved={() => { setShowRaise(false); load() }} />}
    </div>
  )
}

function Row({ a, isManager, expanded, onToggle, onChange }: { a: Action; isManager: boolean; expanded: boolean; onToggle: () => void; onChange: () => void }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [closeComment, setCloseComment] = useState('')
  const [closing, setClosing] = useState(false)

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
