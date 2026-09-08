'use client'
import { useEffect, useRef, useState } from 'react'
import { noteStore } from '@/lib/prelim/note-sync'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Send, ExternalLink } from 'lucide-react'

type Outcome = 'pending' | 'ready' | 'rework' | 'withdrawn'

// The room's call on this drawing. Rework asks for the engineer's email and mails them the
// comment list; ready unlocks hand-over (manage permission) once the marks are saved.
export default function OutcomePanel({ docId, sessionId, outcome, note, reworkTo, handedOver, handedOverBatchId, open, canManage }: {
  docId: string; sessionId: string; outcome: Outcome; note: string | null; reworkTo: string | null; handedOver: boolean; handedOverBatchId: string | null; open: boolean; canManage: boolean
}) {
  const router = useRouter()
  const [o, setO] = useState<Outcome>(outcome)
  const [n, setN] = useState(note ?? '')
  const [noteState, setNoteState] = useState<'' | 'saving' | 'saved' | 'failed'>('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { noteStore.set(note ?? '') }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  // The note goes into the To drawing office / To Lead email, so it must be on the server
  // before the button is pressed: autosave on a short debounce and on blur, and let the
  // buttons wait for an in-flight save (noteStore.flush).
  function saveNote(value: string) {
    if (!open) return
    setNoteState('saving')
    const p = fetch(`/api/prelim/documents/${docId}/outcome`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteOnly: true, note: value }) })
      .then(r => setNoteState(r.ok ? 'saved' : 'failed')).catch(() => setNoteState('failed'))
    noteStore.track(p)
  }
  function onNote(value: string) {
    setN(value); noteStore.set(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => saveNote(value), 600)
  }
  function onNoteBlur() { if (timer.current) { clearTimeout(timer.current); timer.current = null; saveNote(n) } }
  const [email, setEmail] = useState(reworkTo ?? '')
  const [busy, setBusy] = useState<'save' | 'handover' | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  void sessionId

  async function save() {
    setBusy('save'); setErr(''); setMsg('')
    try {
      const res = await fetch(`/api/prelim/documents/${docId}/outcome`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome: o, note: n, reworkToEmail: o === 'rework' ? email : '' }) })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Could not save'); return }
      setMsg(o === 'rework' ? (d.mailed ? `Recorded, and ${email} has been told.` : 'Recorded.') : 'Recorded.')
      router.refresh()
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }
  async function handover() {
    if (!confirm('Hand this drawing over to internal review? It will appear in Incoming Batches for reviewer assignment.')) return
    setBusy('handover'); setErr(''); setMsg('')
    try {
      const res = await fetch(`/api/prelim/documents/${docId}/handover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Hand-over failed'); return }
      setMsg(`Handed over as ${d.ref}.`); router.refresh()
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }

  const pill = (v: Outcome, label: string, cls: string) => (
    <button type="button" disabled={!open} onClick={() => setO(v)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${o === v ? cls : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{label}</button>
  )

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 mr-1">Room&rsquo;s call</span>
        {pill('pending', 'Not yet', 'border-slate-400 bg-slate-100 text-slate-800')}
        {pill('ready', 'Ready for internal review', 'border-emerald-400 bg-emerald-50 text-emerald-800')}
        {pill('rework', 'Rework first', 'border-amber-400 bg-amber-50 text-amber-800')}
        {pill('withdrawn', 'Withdraw', 'border-red-400 bg-red-50 text-red-800')}
        {handedOver && handedOverBatchId && <Link href={`/batches/${handedOverBatchId}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"><ExternalLink className="h-3 w-3" /> In internal review</Link>}
      </div>
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] items-start">
          <div className="space-y-2">
            <div>
              <input className="input" placeholder="Notes to the Drawing office / Engineer — goes into the email with the marked-up drawing" value={n} onChange={e => onNote(e.target.value)} onBlur={onNoteBlur} />
              <p className="mt-0.5 text-[11px] text-slate-400">Notes to the Drawing office / Engineer{noteState === 'saving' ? ' · saving…' : noteState === 'saved' ? ' · saved' : noteState === 'failed' ? ' · could not save' : ''}</p>
            </div>
            {o === 'rework' && <input className="input" placeholder="Engineer's email — they get the comment list" value={email} onChange={e => setEmail(e.target.value)} />}
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy !== null} className="btn-secondary text-xs">{busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Record</button>
            {canManage && outcome === 'ready' && !handedOver && (
              <button onClick={handover} disabled={busy !== null} className="btn-primary text-xs">{busy === 'handover' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Hand over</button>
            )}
          </div>
        </div>
      )}
      {(msg || err) && <p className={`mt-2 text-xs ${err ? 'text-red-600' : 'text-emerald-700'}`}>{err || msg}</p>}
    </div>
  )
}
