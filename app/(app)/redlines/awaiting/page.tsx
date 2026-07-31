'use client'
// "Awaiting your As-Built" — the accepting engineer's standing list. Each
// accepted redline waits here (a day or a month, drawing office is outside the
// system) until the corrected drawing is uploaded. Drawing numbers are locked;
// the filename must carry the number; submit lands the pack at Document
// Control as a 📐 AS-BUILT batch linked to the redline.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, UploadCloud, FileText, CheckCircle } from 'lucide-react'

const CHUNK = 5 * 1024 * 1024 - (5 * 1024 * 1024) % (320 * 1024)

type Item = {
  id: string; submitter_name: string | null; created_by_email: string; accepted_at: string | null
  docs: { drawing_number: string; description: string | null; change_description: string | null }[]
}

export default function AwaitingAsbuiltPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [doneId, setDoneId] = useState<string | null>(null)
  // chosen files per submission: submissionId -> drawingNumber -> File
  const filesRef = useRef<Record<string, Record<string, File>>>({})
  const [, force] = useState(0)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const res = await fetch('/api/redlines/awaiting')
    if (res.ok) setItems((await res.json()).items ?? [])
    setLoading(false)
  }

  function setFile(subId: string, num: string, f: File | null) {
    filesRef.current[subId] = filesRef.current[subId] ?? {}
    if (f) filesRef.current[subId][num] = f
    else delete filesRef.current[subId][num]
    force(x => x + 1)
  }

  async function submit(item: Item) {
    setError('')
    const chosen = filesRef.current[item.id] ?? {}
    const missing = item.docs.filter(d => !chosen[d.drawing_number])
    if (missing.length) { setError(`Attach the As-Built for: ${missing.map(m => m.drawing_number).join(', ')}`); return }
    for (const d of item.docs) {
      const f = chosen[d.drawing_number]
      const norm = d.drawing_number.trim().toUpperCase().replace(/\s+/g, '')
      if (!f.name.toUpperCase().includes(norm)) {
        setError(`"${f.name}" must contain the drawing number ${d.drawing_number} — rename the file so the register stays traceable.`); return
      }
      if (!/\.pdf$/i.test(f.name)) { setError(`"${f.name}" — As-Builts are uploaded as PDF.`); return }
    }
    try {
      const payload: any[] = []
      for (const d of item.docs) {
        const f = chosen[d.drawing_number]
        setBusy(`Uploading ${f.name}…`)
        const start = await fetch('/api/redlines/asbuilt/start-upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId: item.id, fileName: f.name }),
        })
        const sd = await start.json()
        if (!start.ok) throw new Error(sd.error ?? 'Upload session failed')
        const bytes = new Uint8Array(await f.arrayBuffer())
        let uploaded: any = null
        for (let pos = 0; pos < bytes.length; pos += CHUNK) {
          const part = bytes.slice(pos, pos + CHUNK)
          setBusy(`Uploading ${f.name} — ${Math.round(((pos + part.length) / bytes.length) * 100)}%`)
          const r = await fetch(sd.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${pos}-${pos + part.length - 1}/${bytes.length}` },
            body: part as unknown as BodyInit,
          })
          if (!r.ok && r.status !== 202) throw new Error(`Upload failed (${r.status})`)
          if (r.status === 200 || r.status === 201) uploaded = await r.json()
        }
        if (!uploaded?.webUrl) throw new Error('Upload did not complete')
        payload.push({ drawingNumber: d.drawing_number, fileName: uploaded.name ?? f.name, spFileUrl: uploaded.webUrl, revision: null })
      }
      setBusy('Submitting to Document Control…')
      const res = await fetch('/api/redlines/asbuilt/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: item.id, files: payload }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Submit failed')
      setDoneId(item.id)
      await load()
    } catch (e: any) { setError(e?.message ?? 'Something went wrong') }
    finally { setBusy('') }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/redlines" className="btn-secondary text-xs py-1.5 px-3 inline-flex w-fit">
        <ArrowLeft className="h-3.5 w-3.5" /> Redline Register
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Awaiting your As-Built</h1>
        <p className="text-slate-500 text-sm mt-1">
          Redlines you accepted, waiting for the corrected drawing from the drawing office.
          Upload the As-Built here whenever it comes back — it lands at Document Control for the closing check.
        </p>
      </div>

      {doneId && (
        <div className="card p-4 bg-green-50 border-green-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle className="h-4 w-4" /> As-Built submitted — Document Control has been notified.
        </div>
      )}
      {busy && <div className="card p-3 text-sm text-navy-700 flex items-center gap-2"><UploadCloud className="h-4 w-4 animate-pulse" /> {busy}</div>}
      {error && <div className="card p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-700" />
        </div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
          Nothing waiting on you — all your accepted redlines have their As-Builts.
        </div>
      ) : items.map(item => (
        <div key={item.id} className="card">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-semibold text-slate-900">
                Redline by {item.submitter_name ?? item.created_by_email}
              </p>
              <p className="text-xs text-amber-700 font-medium">
                Awaiting As-Built{item.accepted_at ? ` — accepted ${formatDistanceToNow(new Date(item.accepted_at), { addSuffix: true })}` : ''}
              </p>
            </div>
            <button onClick={() => submit(item)} disabled={!!busy}
              className="btn-primary text-sm disabled:opacity-50">
              <UploadCloud className="h-4 w-4" /> Submit As-Built to Document Control
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {item.docs.map(d => (
              <div key={d.drawing_number} className="px-6 py-3 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-mono text-sm font-semibold text-slate-800">{d.drawing_number}</p>
                  <p className="text-xs text-slate-400 truncate">{d.change_description || d.description || '—'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <input type="file" accept=".pdf" className="input text-xs max-w-xs"
                    onChange={e => setFile(item.id, d.drawing_number, e.target.files?.[0] ?? null)} />
                  {filesRef.current[item.id]?.[d.drawing_number] && <CheckCircle className="h-4 w-4 text-emerald-500" />}
                </div>
              </div>
            ))}
          </div>
          <p className="px-6 py-2 text-[11px] text-slate-400 border-t border-slate-100">
            The file name must contain the drawing number. One PDF per drawing.
          </p>
        </div>
      ))}
    </div>
  )
}
