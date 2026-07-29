'use client'
// Site redline upload wizard (driveway C, V1 — ruled 2026-07-29):
// popup form per drawing (number, description, name defaulted from login,
// date defaulted to today, free-text change description) + file (PDF, or
// JPG/PNG converted to a one-page PDF in the browser), chunked upload straight
// to SharePoint, in-app viewer/markup to check quality, submit as one batch.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Plus, Trash2, Eye, Send, FileText, Camera, CheckCircle, UploadCloud, X } from 'lucide-react'

type Draft = { id: string; drawing_number: string; description: string | null;
  change_description: string | null; marked_by: string | null; marked_date: string | null;
  file_name: string | null; source_kind: string }

const CHUNK = 5 * 1024 * 1024 - (5 * 1024 * 1024) % (320 * 1024) // multiple of 320 KiB

async function imageToPdf(file: File): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const img = /png$/i.test(file.type) || /\.png$/i.test(file.name)
    ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  const page = pdf.addPage([img.width, img.height])
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  return pdf.save()
}

export default function RedlineWizard() {
  const [me, setMe] = useState('')
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [docs, setDocs] = useState<Draft[]>([])
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // form state
  const [drawingNumber, setDrawingNumber] = useState('')
  // MDDR gate: the number must match a real register document before the rest
  // of the form unlocks — no redlines against drawings that don't exist.
  const [matched, setMatched] = useState<{ number: string; title: string | null; discipline: string | null; revision: string | null } | null>(null)
  const [lookups, setLookups] = useState<any[]>([])
  const [looking, setLooking] = useState(false)
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [description, setDescription] = useState('')
  const [changeDescription, setChangeDescription] = useState('')
  const [markedBy, setMarkedBy] = useState('')
  const [markedDate, setMarkedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [])
  async function load() {
    const res = await fetch('/api/redlines/mine')
    if (!res.ok) return
    const d = await res.json()
    setSubmissionId(d.submission?.id ?? null)
    setDocs(d.docs ?? [])
    // whoami for the "your name" default
    const who = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null)
    const email = who?.email ?? who?.user?.email ?? ''
    setMe(email)
    if (!markedBy) setMarkedBy(who?.full_name ?? who?.user?.full_name ?? email)
  }

  function resetForm() {
    setDrawingNumber(''); setMatched(null); setLookups([])
    setDescription(''); setChangeDescription('')
    setMarkedDate(format(new Date(), 'yyyy-MM-dd')); setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function onNumberChange(v: string) {
    setDrawingNumber(v)
    setMatched(null)
    if (lookupTimer.current) clearTimeout(lookupTimer.current)
    const clean = v.trim().toUpperCase().replace(/\s+/g, '')
    // per the ruling: the register scan starts once the first "-" is typed
    if (!clean.includes('-')) { setLookups([]); return }
    setLooking(true)
    lookupTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/redlines/lookup-number?q=${encodeURIComponent(clean)}`)
        const d = res.ok ? await res.json() : { results: [] }
        setLookups(d.results ?? [])
        // fully-typed exact number → auto-select the match
        const hit = (d.results ?? []).find((r: any) => r.normalized === clean)
        if (hit) selectMatch(hit)
      } finally { setLooking(false) }
    }, 250)
  }

  function selectMatch(r: any) {
    setMatched({ number: r.number, title: r.title, discipline: r.discipline, revision: r.revision })
    setDrawingNumber(r.number)
    setLookups([])
    if (r.title && !description) setDescription(r.title)
  }

  async function addDocument(keepOpen: boolean) {
    setError('')
    if (!matched) { setError('Select the drawing from the register list first — redlines can only be raised against documents that exist in the system.'); return }
    if (!file) { setError('Attach the scanned redline (PDF) or a photo.'); return }
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
    const isImg = /image\/(jpeg|png)/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name)
    if (!isPdf && !isImg) { setError('Only PDF scans or JPG/PNG photos are accepted.'); return }

    try {
      setBusy(isImg ? 'Converting photo to PDF…' : 'Preparing upload…')
      const pdfBytes: Uint8Array = isImg ? await imageToPdf(file) : new Uint8Array(await file.arrayBuffer())
      const safeBase = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|#%]+/g, '-')
      const fileName = `${drawingNumber.trim().replace(/[\\/:*?"<>|#%]+/g, '-')}__${safeBase}.pdf`

      setBusy('Requesting SharePoint upload…')
      const start = await fetch('/api/redlines/start-upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, submissionId }),
      })
      const sd = await start.json()
      if (!start.ok) throw new Error(sd.error ?? 'Upload session failed')

      let uploaded: any = null
      for (let pos = 0; pos < pdfBytes.length; pos += CHUNK) {
        const part = pdfBytes.slice(pos, pos + CHUNK)
        setBusy(`Uploading… ${Math.round(((pos + part.length) / pdfBytes.length) * 100)}%`)
        const r = await fetch(sd.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${pos}-${pos + part.length - 1}/${pdfBytes.length}` },
          body: part as unknown as BodyInit,
        })
        if (!r.ok && r.status !== 202) throw new Error(`Upload failed (${r.status})`)
        if (r.status === 200 || r.status === 201) uploaded = await r.json()
      }
      if (!uploaded?.webUrl) throw new Error('Upload did not complete')

      setBusy('Saving…')
      const reg = await fetch('/api/redlines/docs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: sd.submissionId, drawingNumber, description, changeDescription,
          markedBy, markedDate, fileName: uploaded.name ?? fileName,
          spFileUrl: uploaded.webUrl, sourceKind: isImg ? 'photo' : 'scan',
        }),
      })
      const rd = await reg.json()
      if (!reg.ok) throw new Error(rd.error ?? 'Could not save document')
      setSubmissionId(sd.submissionId)
      resetForm()
      if (!keepOpen) setShowForm(false)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong')
    } finally { setBusy('') }
  }

  async function removeDoc(id: string) {
    await fetch(`/api/redlines/docs/${id}`, { method: 'DELETE' })
    await load()
  }

  async function submitBatch() {
    if (!submissionId || !docs.length) return
    setBusy('Submitting batch to Document Control…'); setError('')
    const res = await fetch('/api/redlines/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId }),
    })
    const d = await res.json()
    setBusy('')
    if (!res.ok) { setError(d.error ?? 'Submit failed'); return }
    setDone(true)
  }

  if (done) return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-10 text-center">
        <CheckCircle className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Redline batch submitted</h2>
        <p className="text-slate-500">Document Control has been notified and will route it to the responsible engineer.</p>
        <button onClick={() => { setDone(false); setDocs([]); setSubmissionId(null); load() }}
          className="btn-primary mt-6 inline-flex">Upload another redline</button>
      </div>
    </div>
  )

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Upload Site Redline</h1>
        <p className="text-slate-500 text-sm mt-1">
          Scan your marked-up drawing and upload the PDF (preferred). A photo works as a last
          resort — it's converted to PDF so you can still check and mark it up in the viewer.
          Add as many drawings as you need, then submit the whole batch to Document Control.
        </p>
      </div>

      {/* basket */}
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Documents in this batch ({docs.length})</h2>
          <button onClick={() => setShowForm(true)} className="btn-primary text-xs py-1.5 px-3">
            <Plus className="h-3.5 w-3.5" /> Add redlined drawing
          </button>
        </div>
        <div className="divide-y divide-slate-50">
          {docs.length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-400">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No drawings added yet.</p>
            </div>
          ) : docs.map(d => (
            <div key={d.id} className="px-6 py-4 flex items-center gap-4">
              {d.source_kind === 'photo'
                ? <Camera className="h-5 w-5 text-amber-500 shrink-0" aria-label="photo" />
                : <FileText className="h-5 w-5 text-slate-400 shrink-0" aria-label="scan" />}
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-semibold text-slate-800">{d.drawing_number}</p>
                <p className="text-xs text-slate-500 truncate">
                  {d.description || '—'} · marked by {d.marked_by ?? '—'}{d.marked_date ? ` on ${d.marked_date}` : ''}
                </p>
                {d.change_description && <p className="text-xs text-slate-400 italic truncate">"{d.change_description}"</p>}
              </div>
              <Link href={`/redlines/docs/${d.id}/view`}
                className="btn-secondary text-xs py-1.5 px-3" title="Check quality / add markup">
                <Eye className="h-3.5 w-3.5" /> View / mark up
              </Link>
              <button onClick={() => removeDoc(d.id)} className="p-1.5 text-slate-400 hover:text-red-500" title="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {busy && <div className="card p-3 text-sm text-navy-700 flex items-center gap-2"><UploadCloud className="h-4 w-4 animate-pulse" /> {busy}</div>}
      {error && <div className="card p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

      <button onClick={submitBatch} disabled={!docs.length || !!busy}
        className="btn-primary w-full justify-center py-3 text-base disabled:opacity-50">
        <Send className="h-5 w-5" /> Submit batch to Document Control ({docs.length})
      </button>

      {/* add-document modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto py-10">
          <div className="card w-full max-w-lg p-6 space-y-3 bg-white">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Add redlined drawing</h2>
              <button onClick={() => { setShowForm(false); resetForm() }} className="p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
            <div>
              <label className="label">Drawing number * <span className="font-normal text-slate-400">— must exist in the register</span></label>
              {matched ? (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-semibold text-emerald-900">{matched.number}</p>
                    <p className="text-xs text-emerald-700 truncate">
                      {matched.title ?? 'Matched in the MDDR register'}
                      {matched.discipline ? ` · ${matched.discipline}` : ''}{matched.revision ? ` · latest Rev ${matched.revision}` : ''}
                    </p>
                  </div>
                  <button onClick={() => { setMatched(null); setDrawingNumber(''); }}
                    className="text-xs text-emerald-700 underline shrink-0">change</button>
                </div>
              ) : (
                <div className="relative">
                  <input value={drawingNumber} onChange={e => onNumberChange(e.target.value)}
                    placeholder="Start typing… e.g. 6105AE102-6253-EFND-0002" className="input font-mono" autoFocus />
                  {(lookups.length > 0 || looking) && drawingNumber.includes('-') && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg divide-y divide-slate-50">
                      {looking && <p className="px-3 py-2 text-xs text-slate-400">Searching the register…</p>}
                      {lookups.map((r: any) => (
                        <button key={r.normalized} type="button" onClick={() => selectMatch(r)}
                          className="w-full text-left px-3 py-2 hover:bg-emerald-50">
                          <span className="block font-mono text-sm text-slate-800">{r.number}</span>
                          <span className="block text-xs text-slate-400 truncate">{r.title ?? '—'}{r.discipline ? ` · ${r.discipline}` : ''}</span>
                        </button>
                      ))}
                      {!looking && lookups.length === 0 && (
                        <p className="px-3 py-2 text-xs text-slate-400">No register documents match — check the number.</p>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">
                    The list narrows as you type (matching starts after the first “-”). Pick the document —
                    the rest of the form unlocks once it's matched.
                  </p>
                </div>
              )}
            </div>
            <fieldset disabled={!matched} className={matched ? '' : 'opacity-40 pointer-events-none select-none'}>
            <div>
              <label className="label">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Drawing title / what it is" className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="label">Marked up by</label>
                <input value={markedBy} onChange={e => setMarkedBy(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Date marked</label>
                <input type="date" value={markedDate} onChange={e => setMarkedDate(e.target.value)} className="input" />
              </div>
            </div>
            <div className="mt-3">
              <label className="label">Describe the changes you made *</label>
              <textarea value={changeDescription} onChange={e => setChangeDescription(e.target.value)}
                rows={3} className="input resize-none"
                placeholder="e.g. Cable route changed on level 2 — rerouted around new HVAC duct; gland sizes updated…" />
            </div>
            <div className="mt-3">
              <label className="label">Scanned redline (PDF preferred) or photo (JPG/PNG)</label>
              <input ref={fileRef} type="file" accept=".pdf,image/jpeg,image/png"
                onChange={e => setFile(e.target.files?.[0] ?? null)} className="input" />
              <p className="text-[11px] text-slate-400 mt-1">Photos are converted to PDF automatically. Scan-to-PC then upload gives the best quality.</p>
            </div>
            </fieldset>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => addDocument(true)} disabled={!!busy || !matched} className="btn-secondary text-sm flex-1 justify-center disabled:opacity-50">
                {busy ? busy : 'Save & add another'}
              </button>
              <button onClick={() => addDocument(false)} disabled={!!busy || !matched} className="btn-primary text-sm flex-1 justify-center disabled:opacity-50">
                {busy ? busy : 'Save & close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
