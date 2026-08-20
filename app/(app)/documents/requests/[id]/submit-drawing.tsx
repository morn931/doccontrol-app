'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import EmailPicker, { type EmailEntry } from '@/components/email-picker'

type Rec = EmailEntry

// Graph upload-session chunk size — a multiple of 320 KiB, as Graph requires for all but the
// final chunk. The browser PUTs these straight to SharePoint (no Vercel 4.5 MB body cap).
const CHUNK = 5 * 1024 * 1024 - (5 * 1024 * 1024) % (320 * 1024)

/**
 * The internal-engineering document-submission area: drag or browse the drawing to
 * submit it for review against an already-allocated RDMC number, and (internal only)
 * recommend reviewers for the Document Controller. Posts to /api/documents/internal-submit
 * (route handler → creates an internal batch + emails the Controller with the picks).
 * The Controller still has the final say on the Assign Reviewers screen.
 */
export default function SubmitDrawing({ lineId, rdmc, revision, packageId, mode = 'first', canSignoffOnly = false }: {
  lineId: string
  rdmc: string
  revision: string | null
  packageId?: string | null
  mode?: 'first' | 'newRevision'
  /** The current user may send a returned-from-Aconex revision STRAIGHT to sign-off (DC/admin).
   *  When false, ticking "sign-off only" raises a request the DC then flags. */
  canSignoffOnly?: boolean
}) {
  const isNewRev = mode === 'newRevision'
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [msg, setMsg] = useState<{ type: 'err' | 'ok'; text: string } | null>(null)
  const [progress, setProgress] = useState('')
  const [pending, start] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Recommended-reviewers picker — quick-pick chips from historical patterns + a company
  // email combobox (EmailPicker) for anyone else.
  const [suggestions, setSuggestions] = useState<{ email: string; name: string; reviewCount: number }[]>([])
  const [recs, setRecs] = useState<Rec[]>([])
  // A new revision returned from Aconex was already reviewed → the owner can request it go
  // straight to sign-off (the Document Controller flags it). Only offered on a new revision.
  const [signoffOnlyReq, setSignoffOnlyReq] = useState(false)
  const needReviewers = !(isNewRev && signoffOnlyReq)

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

  function submit(confirmSameRevision = false) {
    if (!file) { setMsg({ type: 'err', text: 'Choose a drawing file first.' }); return }
    if (needReviewers && !recs.length) { setMsg({ type: 'err', text: 'Select at least one reviewer before submitting.' }); return }
    const theFile = file
    start(async () => {
      try {
        // 1) Validate the number/revision and get a direct SharePoint upload URL — the file
        //    never passes through Vercel, so big PDFs don't hit the 4.5 MB request-body cap.
        setMsg(null); setProgress('Checking number…')
        const startRes = await fetch('/api/documents/internal-submit/start-upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lineId, fileName: theFile.name, newRevision: isNewRev, confirmSameRevision, signoffOnly: isNewRev && signoffOnlyReq && canSignoffOnly }),
        })
        const sd = await startRes.json()
        if (!startRes.ok) {
          if (sd.needsConfirm === 'sameRevision' && !confirmSameRevision) {
            setProgress('')
            if (typeof window !== 'undefined' && window.confirm(sd.error)) { submit(true); return }
            setMsg({ type: 'err', text: 'Cancelled — no new revision submitted.' }); return
          }
          setProgress(''); setMsg({ type: 'err', text: sd.error ?? 'Submission failed.' }); return
        }

        // 2) Upload the file straight to SharePoint in chunks.
        const bytes = new Uint8Array(await theFile.arrayBuffer())
        let uploaded: { webUrl?: string; name?: string } | null = null
        for (let pos = 0; pos < bytes.length; pos += CHUNK) {
          const part = bytes.slice(pos, pos + CHUNK)
          setProgress(`Uploading… ${Math.round(((pos + part.length) / bytes.length) * 100)}%`)
          const r = await fetch(sd.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${pos}-${pos + part.length - 1}/${bytes.length}` },
            body: part as unknown as BodyInit,
          })
          if (!r.ok && r.status !== 202) throw new Error(`Upload failed (${r.status})`)
          if (r.status === 200 || r.status === 201) uploaded = await r.json()
        }
        if (!uploaded?.webUrl) throw new Error('Upload did not complete — please try again.')

        // 3) Finalise — create the internal batch/document/version from the SharePoint URL.
        setProgress('Submitting…')
        const res = await fetch('/api/documents/internal-submit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lineId, fileName: uploaded.name ?? theFile.name, spFileUrl: uploaded.webUrl,
            newRevision: isNewRev, confirmSameRevision, recommendedReviewers: recs,
            ...(isNewRev && signoffOnlyReq
              ? (canSignoffOnly ? { signoffOnly: true } : { requestSignoffOnly: true })
              : {}),
          }),
        })
        const data = await res.json()
        setProgress('')
        if (!res.ok) { setMsg({ type: 'err', text: data.error ?? 'Submission failed.' }); return }
        setMsg({ type: 'ok', text: !(isNewRev && signoffOnlyReq)
          ? `Submitted for review as ${data.docNumber} (Rev ${data.revision}). It's now an internal batch awaiting reviewer assignment.`
          : canSignoffOnly
            ? `Sent straight to sign-off as ${data.docNumber} (Rev ${data.revision}) — review skipped (already reviewed on Aconex). Open the batch to request signatures.`
            : `Submitted as ${data.docNumber} (Rev ${data.revision}) with a request to go straight to sign-off. The Document Controller will send it for signatures, or route it to review.` })
        setFile(null); setRecs([]); setSignoffOnlyReq(false)
        router.refresh()
      } catch (e: any) {
        setProgress(''); setMsg({ type: 'err', text: e?.message ?? 'Network error.' })
      }
    })
  }

  return (
    <div className={`mt-3 rounded-lg border p-3 ${isNewRev ? 'border-amber-200 bg-amber-50/50' : 'border-teal-200 bg-teal-50/40'}`}>
      <div className={`mb-2 flex items-center gap-2 text-xs font-semibold ${isNewRev ? 'text-amber-800' : 'text-teal-800'}`}>
        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${isNewRev ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'}`}>{isNewRev ? 'New revision' : 'Internal review'}</span>
        {isNewRev
          ? <>Book a newer revision for <span className="font-mono">{rdmc}</span> — a fresh review &amp; sign-off cycle on the same document</>
          : <>Submit the drawing for review — number confirmed against <span className="font-mono">{rdmc}</span></>}
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

      {isNewRev && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/70 p-2.5 text-xs text-amber-900">
          <input type="checkbox" checked={signoffOnlyReq} onChange={(e) => setSignoffOnlyReq(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
          <span>
            <span className="font-semibold">Returned from Aconex — {canSignoffOnly ? 'send' : 'request'} straight to sign-off.</span>{' '}
            The previous revision was already reviewed, so it doesn&apos;t need reviewing again.
            {canSignoffOnly ? ' It goes directly to signatures — no review cycle.' : ' The Document Controller confirms and sends it for signatures.'}
            <span className="text-amber-700"> No reviewers needed.</span>
          </span>
        </label>
      )}

      {/* Recommend reviewers (internal only) — the Document Controller prefills from these, final say hers */}
      {needReviewers && (
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-slate-700">Reviewers <span className="text-red-600">*</span> <span className="font-normal text-slate-400">— select who must review this before you submit</span></div>

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

        <EmailPicker value={recs} onChange={setRecs} placeholder="Select reviewers from the list…" />
      </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        {msg ? (
          <p className={`text-xs ${msg.type === 'err' ? 'text-rose-600' : 'text-emerald-700'}`}>{msg.text}</p>
        ) : <span />}
        <button
          onClick={() => submit()}
          disabled={pending || !file || (needReviewers && !recs.length)}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-40 ${isNewRev ? 'bg-amber-700 hover:bg-amber-800' : 'bg-teal-700 hover:bg-teal-800'}`}
        >
          {pending ? (progress || 'Submitting…') : isNewRev ? (signoffOnlyReq ? (canSignoffOnly ? 'Send to sign-off' : 'Request sign-off only') : 'Submit new revision') : 'Submit for review'}
        </button>
      </div>
    </div>
  )
}
