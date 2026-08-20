'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

// Graph upload-session chunk size — a multiple of 320 KiB (Graph requires it for all but the final
// chunk). The browser PUTs these straight to SharePoint (no Vercel 4.5 MB body cap).
const CHUNK = 5 * 1024 * 1024 - (5 * 1024 * 1024) % (320 * 1024)

type CddlDoc = {
  id: string; package_code: string; docno: string; title: string | null
  discipline: string | null; doc_type: string | null; revision: string | null
  aconex_review_status: string | null; doc_owner: string | null
}

/**
 * Sign-off Intake (Document Controller): pick a document from the CDDL, upload the file downloaded
 * from Aconex, and send it STRAIGHT TO SIGN-OFF — review skipped (already reviewed on Aconex).
 * No prior CoreDocs submission needed; the CDDL entry is the source of truth.
 */
export default function SignoffIntake() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CddlDoc[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<CddlDoc | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ type: 'err' | 'ok'; text: string } | null>(null)
  const [progress, setProgress] = useState('')
  const [pending, start] = useTransition()

  // Debounced CDDL search.
  useEffect(() => {
    if (picked) return
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/cddl/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, picked])

  function pickDoc(d: CddlDoc) { setPicked(d); setResults([]); setMsg(null) }
  function reset() { setPicked(null); setFile(null); setQ(''); setMsg(null) }

  function submit(confirmNumber = false) {
    if (!picked) { setMsg({ type: 'err', text: 'Pick a document from the CDDL first.' }); return }
    if (!file) { setMsg({ type: 'err', text: 'Choose the file you downloaded from Aconex.' }); return }
    const theFile = file
    start(async () => {
      try {
        setMsg(null); setProgress('Checking…')
        const startRes = await fetch('/api/documents/signoff-intake/start-upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: picked.id, fileName: theFile.name, confirmNumber }),
        })
        const sd = await startRes.json()
        if (!startRes.ok) {
          if (sd.needsConfirm === 'number' && !confirmNumber) {
            setProgress('')
            if (typeof window !== 'undefined' && window.confirm(sd.error)) { submit(true); return }
            setMsg({ type: 'err', text: 'Cancelled — nothing uploaded.' }); return
          }
          setProgress(''); setMsg({ type: 'err', text: sd.error ?? 'Upload failed.' }); return
        }

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

        setProgress('Sending to sign-off…')
        const res = await fetch('/api/documents/signoff-intake', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: picked.id, fileName: uploaded.name ?? theFile.name, spFileUrl: uploaded.webUrl }),
        })
        const data = await res.json()
        setProgress('')
        if (!res.ok) { setMsg({ type: 'err', text: data.error ?? 'Could not send to sign-off.' }); return }
        setMsg({ type: 'ok', text: `${data.docNumber} (Rev ${data.revision}) is ready for sign-off. Opening the batch…` })
        setTimeout(() => router.push(`/batches/${data.batchId}`), 900)
      } catch (e: any) {
        setProgress(''); setMsg({ type: 'err', text: e?.message ?? 'Network error.' })
      }
    })
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Sign-off Intake</h1>
      <p className="mt-1 text-sm text-slate-500">
        For a document returned from Aconex, already reviewed. Pick it from the CDDL, upload the file you
        downloaded, and it goes <span className="font-medium text-teal-700">straight to sign-off</span> — no review cycle.
      </p>

      {/* Step 1 — pick the document from the CDDL */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">1 · Choose the document (CDDL)</div>
        {picked ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
            <div>
              <div className="font-mono text-sm font-semibold text-teal-900">{picked.docno}</div>
              <div className="text-sm text-slate-700">{picked.title ?? '—'}</div>
              <div className="mt-1 text-xs text-slate-500">
                {[picked.package_code, picked.discipline, picked.doc_type, picked.revision ? `Rev ${picked.revision}` : null]
                  .filter(Boolean).join('  ·  ')}
              </div>
            </div>
            <button onClick={reset} className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">Change</button>
          </div>
        ) : (
          <>
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search the CDDL by document number or title…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none"
            />
            {searching && <div className="mt-2 text-xs text-slate-400">Searching…</div>}
            {!!results.length && (
              <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
                {results.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => pickDoc(d)} className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-teal-50">
                      <span className="font-mono text-sm text-slate-800">{d.docno}</span>
                      <span className="text-xs text-slate-500">{d.title ?? '—'}{d.revision ? `  ·  Rev ${d.revision}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {q.trim().length >= 2 && !searching && !results.length && (
              <div className="mt-2 text-xs text-slate-400">No CDDL match. Check the number, or the document may not be in the CDDL yet.</div>
            )}
          </>
        )}
      </div>

      {/* Step 2 — upload the file */}
      <div className={`mt-4 rounded-xl border border-slate-200 bg-white p-4 ${picked ? '' : 'opacity-50 pointer-events-none'}`}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">2 · Upload the file from Aconex</div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); setMsg(null); setFile(e.dataTransfer.files?.[0] ?? null) }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
            drag ? 'border-teal-400 bg-teal-100/50' : 'border-teal-300 bg-white hover:border-teal-400'
          }`}
        >
          <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { setMsg(null); setFile(e.target.files?.[0] ?? null) }} />
          {file ? (
            <div className="text-sm font-medium text-slate-700">{file.name} <span className="text-slate-400">({(file.size / 1024 / 1024).toFixed(1)} MB)</span></div>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-600">Drag the document here, or click to browse</div>
              {picked && <div className="mt-0.5 text-[11px] text-slate-400">Name it <span className="font-mono">{picked.docno}_{picked.revision ?? '0'}.pdf</span> so the number is confirmed</div>}
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {msg ? <p className={`text-sm ${msg.type === 'err' ? 'text-rose-600' : 'text-emerald-700'}`}>{msg.text}</p> : <span />}
        <button
          onClick={() => submit()}
          disabled={pending || !picked || !file}
          className="shrink-0 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-40"
        >
          {pending ? (progress || 'Working…') : 'Send to sign-off'}
        </button>
      </div>
    </div>
  )
}
