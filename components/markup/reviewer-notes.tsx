'use client'

// Top-of-document banner for reviewers. Two things live here:
//  1. Reviewer handover NOTES (unchanged) — reviewer-to-reviewer FYI, not in the transmittal.
//  2. ENGINEERING ACTIONS — the reworked "yellow function": raise a tracked action that
//     writes to the Engineering Action Register with an owner + status + a reply thread,
//     so the question/answer loop actually closes (the raiser is notified of the answer).

import { useEffect, useState } from 'react'
import { StickyNote, Plus, ClipboardList, MessageSquare } from 'lucide-react'
import { format } from 'date-fns'

type Note = { id: string; author_email: string; author_name: string | null; note_text: string; created_at: string }
type Reply = { id: string; author_name: string | null; author_email: string; body: string; created_at: string }
type Action = { id: string; action_ref: string; description: string; assigned_to_email: string | null; assigned_to_name: string | null; status: string; priority: string | null; replies: Reply[] }
type User = { email: string; full_name: string | null }

const nm = (e: string | null, n: string | null) => n || (e ? e.split('@')[0] : '—')

export default function ReviewerNotes({ reviewTaskId }: { reviewTaskId: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [actions, setActions] = useState<Action[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [raising, setRaising] = useState(false)

  async function loadNotes() { try { const r = await fetch(`/api/reviews/${reviewTaskId}/notes`); if (r.ok) setNotes((await r.json()).notes ?? []) } catch {} }
  async function loadActions() { try { const r = await fetch(`/api/engineering-actions?reviewTaskId=${reviewTaskId}`); if (r.ok) setActions((await r.json()).actions ?? []) } catch {} }
  useEffect(() => { loadNotes(); loadActions() }, [reviewTaskId])
  useEffect(() => { fetch('/api/engineering-actions?assignees=1').then(r => r.json()).then(d => setUsers(d.users ?? [])).catch(() => {}) }, [])

  async function saveNote() {
    if (!text.trim()) return
    setSaving(true); setErr('')
    const res = await fetch(`/api/reviews/${reviewTaskId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: text.trim() }) })
    setSaving(false)
    if (res.ok) { setText(''); setAdding(false); loadNotes() } else setErr((await res.json().catch(() => ({})))?.error || 'Could not save the note.')
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
      {/* ── Notes ── */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-amber-800">
            <StickyNote className="h-4 w-4" />
            <span className="text-sm font-semibold">Notes for reviewers{notes.length ? ` (${notes.length})` : ''}</span>
            <span className="text-xs text-amber-600">— internal handover, not in the transmittal</span>
          </div>
          {!adding && <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700"><Plus className="h-3.5 w-3.5" /> Add note</button>}
        </div>
        {notes.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {notes.map(n => (
              <li key={n.id} className="text-sm text-slate-700">
                <span className="font-medium text-slate-900">{nm(n.author_email, n.author_name)}</span>
                <span className="text-xs text-slate-400"> · {format(new Date(n.created_at), 'd MMM yyyy')}</span>
                <span className="block whitespace-pre-wrap">{n.note_text}</span>
              </li>
            ))}
          </ul>
        )}
        {adding && (
          <div className="mt-2 space-y-2">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={2} autoFocus placeholder="Note for the next reviewer(s)…" className="w-full rounded-md border border-amber-300 p-2 text-sm" />
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button onClick={saveNote} disabled={saving || !text.trim()} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save note'}</button>
              <button onClick={() => { setAdding(false); setText(''); setErr('') }} className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-amber-100">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Engineering actions ── */}
      <div className="border-t border-amber-200 pt-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-teal-800">
            <ClipboardList className="h-4 w-4" />
            <span className="text-sm font-semibold">Engineering actions{actions.length ? ` (${actions.length})` : ''}</span>
            <span className="text-xs text-teal-600">— tracked in the register, closes the loop</span>
          </div>
          {!raising && <button onClick={() => setRaising(true)} className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700"><Plus className="h-3.5 w-3.5" /> Log engineering action</button>}
        </div>

        {actions.length > 0 && (
          <ul className="mt-2 space-y-2">
            {actions.map(a => <ActionItem key={a.id} a={a} onChange={loadActions} />)}
          </ul>
        )}

        {raising && <RaiseInline reviewTaskId={reviewTaskId} users={users} onDone={() => { setRaising(false); loadActions() }} onCancel={() => setRaising(false)} />}
      </div>
    </div>
  )
}

function ActionItem({ a, onChange }: { a: Action; onChange: () => void }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  async function send() { if (!reply.trim()) return; setBusy(true); await fetch(`/api/engineering-actions/${a.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply.trim() }) }); setReply(''); setBusy(false); onChange() }
  const done = a.status === 'closed' || a.status === 'dismissed'
  return (
    <li className="rounded-md border border-teal-100 bg-white p-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs text-slate-400">{a.action_ref}</span>
        <span className="text-slate-800">{a.description}</span>
        <span className="text-xs text-slate-400">→ {nm(a.assigned_to_email, a.assigned_to_name)}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs capitalize ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{a.status.replace('_', ' ')}</span>
      </div>
      {a.replies.length > 0 && (
        <ul className="mt-1.5 space-y-1 pl-2 border-l-2 border-slate-100">
          {a.replies.map(r => <li key={r.id} className="text-xs text-slate-600"><span className="font-medium text-slate-800">{nm(r.author_email, r.author_name)}:</span> {r.body}</li>)}
        </ul>
      )}
      {!done && (
        <div className="mt-1.5 flex gap-1.5">
          <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Answer / reply…" onKeyDown={e => e.key === 'Enter' && send()} className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs" />
          <button onClick={send} disabled={busy || !reply.trim()} className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><MessageSquare className="h-3 w-3" /> Reply</button>
        </div>
      )}
    </li>
  )
}

function RaiseInline({ reviewTaskId, users, onDone, onCancel }: { reviewTaskId: string; users: User[]; onDone: () => void; onCancel: () => void }) {
  const [description, setDescription] = useState('')
  const [assignedToEmail, setAssignedToEmail] = useState('')
  const [priority, setPriority] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    if (!description.trim()) return
    setSaving(true); setErr('')
    const u = users.find(x => x.email === assignedToEmail)
    const res = await fetch('/api/engineering-actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewTaskId, description: description.trim(), assignedToEmail: assignedToEmail || undefined, assignedToName: u?.full_name || undefined, priority: priority || undefined }) })
    setSaving(false)
    if (res.ok) onDone(); else setErr((await res.json().catch(() => ({})))?.error || 'Could not save.')
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border border-teal-200 bg-white p-2">
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} autoFocus placeholder="The action — what needs resolving, and the question if any…" className="w-full rounded-md border border-slate-300 p-2 text-sm" />
      <div className="flex flex-wrap gap-2 items-center">
        <select value={assignedToEmail} onChange={e => setAssignedToEmail(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Assign to…</option>{users.map(u => <option key={u.email} value={u.email}>{u.full_name || u.email}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Priority…</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
        <span className="text-xs text-slate-400">Raised by you · document defaults from this review</span>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving || !description.trim()} className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{saving ? 'Logging…' : 'Log action'}</button>
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  )
}
