'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import EmailPicker, { type EmailEntry } from '@/components/email-picker'

type Rec = EmailEntry

/**
 * The internal-engineering document-submission area: drag or browse the drawing to
 * submit it for review against an already-allocated RDMC number, and (internal only)
 * recommend reviewers for the Document Controller. Posts to /api/documents/internal-submit
 * (route handler → creates an internal batch + emails the Controller with the picks).
 * The Controller still has the final say on the Assign Reviewers screen.
 */
export default function SubmitDrawing({ lineId, rdmc, revision, packageId }: {
  lineId: string
  rdmc: string
  revision: string | null
  packageId?: string | null
}) {
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [msg, setMsg] = useState<{ type: 'err' | 'ok'; text: string } | null>(null)
  const [pending, start] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Recommended-reviewers picker — quick-pick chips from historical patterns + a company
  // email combobox (EmailPicker) for anyone else.
  const [suggestions, setSuggestions] = useState<{ email: string; name: string; reviewCount: number }[]>([])
  const [recs, setRecs] = useState<Rec[]>([])

  useEffect(() => {
    const qs = packageId ? `?packageId=${packageId}` : ''
    fetch(`/api/reviewer-suggestions${qs}`)
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((d) => setSuggestions(d.suggestions ?? []))
      .catch(() => {})
  }, [packageId])

  const addRec = (email: string, name: string) => {
    const e = email.trim()
    if (!e || recs.find((r) => r.email.toLowerCase() === e.toLowerCase())) return
    setRecs([...recs, { email: e, name: name.trim() || e }])
  }
  const unusedSuggestions = suggestions.filter((s) => !recs.find((r) => r.email === s.email))

  function pick(f: File | null) { setMsg(null); setFile(f) }

  function submit() {
    if (!file) { setMsg({ type: 'err', text: 'Choose a drawing file first.' }); return }
    const fd = new FormData()
    fd.set('file', file)
    fd.set('lineId', lineId)
    if (recs.length) fd.set('recommendedReviewers', JSON.stringify(recs))
    start(async () => {
      try {
        const res = await fetch('/api/documents/internal-submit', { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok) { setMsg({ type: 'err', text: data.error ?? 'Submission failed.' }); return }
        setMsg({ type: 'ok', text: `Submitted for review as ${data.docNumber} (Rev ${data.revision}). It's now an internal batch awaiting reviewer assignment.` })
        setFile(null); setRecs([])
        router.refresh()
      } catch (e: any) {
        setMsg({ type: 'err', text: e?.message ?? 'Network error.' })
      }
    })
  }

  return (
    <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-teal-800">
        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-teal-700">Internal review</span>
        Submit the drawing for review — number confirmed against <span className="font-mono">{rdmc}</span>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null) }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 text-center transition ${
          drag ? 'border-teal-400 bg-teal-100/50' : 'border-teal-300 bg-white hover:border-teal-400'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="text-sm font-medium text-slate-700">{file.name} <span className="text-slate-400">({(file.size / 1024 / 1024).toFixed(1)} MB)</span></div>
        ) : (
          <>
            <div className="text-sm font-medium text-slate-600">Drag the drawing here, or click to browse</div>
            <div className="mt-0.5 text-[11px] text-slate-400">Name it <span className="font-mono">{rdmc}_{revision ?? 'A'}.pdf</span> so the number is confirmed on upload</div>
          </>
        )}
      </div>

      {/* Recommend reviewers (internal only) — the Document Controller prefills from these, final say hers */}
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-slate-700">Recommend reviewers <span className="font-normal text-slate-400">(optional — the Document Controller decides finally)</span></div>

        {unusedSuggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {unusedSuggestions.slice(0, 6).map((s) => (
              <button key={s.email} onClick={() => addRec(s.email, s.name)}
                className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800">
                + {s.name} <span className="text-slate-400">({s.reviewCount})</span>
              </button>
            ))}
          </div>
        )}

        <EmailPicker value={recs} onChange={setRecs} placeholder="Search company emails or type one to add…" />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {msg ? (
          <p className={`text-xs ${msg.type === 'err' ? 'text-rose-600' : 'text-emerald-700'}`}>{msg.text}</p>
        ) : <span />}
        <button
          onClick={submit}
          disabled={pending || !file}
          className="shrink-0 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:opacity-40"
        >
          {pending ? 'Submitting…' : 'Submit for review'}
        </button>
      </div>
    </div>
  )
}
