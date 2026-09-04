'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import FolderBrowser from './folder-browser'

export default function NewSessionForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [area, setArea] = useState('')
  const [heldOn, setHeldOn] = useState(new Date().toISOString().slice(0, 10))
  const [attendees, setAttendees] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!title.trim()) { setError('Give the session a title.'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/prelim/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, area, heldOn, attendees, folder }) })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not open the session'); return }
      router.push(`/prelim/${d.id}`)
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="btn-primary w-fit"><Plus className="h-4 w-4" /> Open a session</button>
  return (
    <div className="card p-6 space-y-4 max-w-3xl">
      <h2 className="font-semibold text-slate-900">Open a prelim session</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label">Title <span className="text-red-500">*</span></label><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Main Consumer Substation — tender drawings, batch 1" /></div>
        <div><label className="label">Area / substation</label><input className="input" value={area} onChange={e => setArea(e.target.value)} placeholder="Main Consumer Substation" /></div>
        <div><label className="label">Held on</label><input type="date" className="input" value={heldOn} onChange={e => setHeldOn(e.target.value)} /></div>
        <div><label className="label">In the room</label><input className="input" value={attendees} onChange={e => setAttendees(e.target.value)} placeholder="Johan, Vossie, Bennie…" /></div>
      </div>
      <div>
        <label className="label">Source folder <span className="text-slate-400 font-normal">— navigate to the folder the drawings are in; files are pulled from the session page</span></label>
        <FolderBrowser path={folder} onPath={setFolder} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Open session</button>
        <button onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}
