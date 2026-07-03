'use client'

// Internal reviewer-to-reviewer handover notes, shown at the top when a document
// opens. Accumulate down the chain; NOT part of the transmittal.

import { useEffect, useState } from 'react'
import { StickyNote, Plus } from 'lucide-react'
import { format } from 'date-fns'

type Note = { id: string; author_email: string; author_name: string | null; note_text: string; created_at: string }

export default function ReviewerNotes({ reviewTaskId }: { reviewTaskId: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    try { const res = await fetch(`/api/reviews/${reviewTaskId}/notes`); if (res.ok) setNotes((await res.json()).notes ?? []) } catch {}
  }
  useEffect(() => { load() }, [reviewTaskId])

  async function save() {
    if (!text.trim()) return
    setSaving(true); setErr('')
    const res = await fetch(`/api/reviews/${reviewTaskId}/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: text.trim() }),
    })
    setSaving(false)
    if (res.ok) { setText(''); setAdding(false); load() }
    else setErr((await res.json().catch(() => ({})))?.error || 'Could not save the note.')
  }

  const name = (n: Note) => n.author_name || n.author_email.split('@')[0]

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-amber-800">
          <StickyNote className="h-4 w-4" />
          <span className="text-sm font-semibold">Notes for reviewers{notes.length ? ` (${notes.length})` : ''}</span>
          <span className="text-xs text-amber-600">— internal handover, not in the transmittal</span>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700">
            <Plus className="h-3.5 w-3.5" /> Add note to next reviewer
          </button>
        )}
      </div>

      {notes.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {notes.map(n => (
            <li key={n.id} className="text-sm text-slate-700">
              <span className="font-medium text-slate-900">{name(n)}</span>
              <span className="text-xs text-slate-400"> · {format(new Date(n.created_at), 'd MMM yyyy')}</span>
              <span className="block whitespace-pre-wrap">{n.note_text}</span>
            </li>
          ))}
        </ul>
      ) : (!adding && <p className="mt-1 text-xs text-amber-700/70">No notes yet.</p>)}

      {adding && (
        <div className="mt-2 space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus
            placeholder="Note for the next reviewer(s)…" className="w-full rounded-md border border-amber-300 p-2 text-sm" />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !text.trim()}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save note'}</button>
            <button onClick={() => { setAdding(false); setText(''); setErr('') }}
              className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-amber-100">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
