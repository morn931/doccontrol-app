'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Rec = { email: string; name: string }

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

  // Recommended-reviewers picker
  const [suggestions, setSuggestions] = useState<{ email: string; name: string; reviewCount: number }[]>([])
  const [users, setUsers] = useState<{ email: string; full_name: string | null; role: string }[]>([])
  const [recs, setRecs] = useState<Rec[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    const qs = packageId ? `?packageId=${packageId}` : ''
    fetch(`/api/reviewer-suggestions${qs}`)
      .then((r) => (r.ok ? r.json() : { suggestions: [], users: [] }))
      .then((d) => { setSuggestions(d.suggestions ?? []); setUsers(d.users ?? []) })
      .catch(() => {})
  }, [packageId])

  function addRec(email: string, name: string) {
    const e = email.trim()
    if (!e || recs.find((r) => r.email === e)) return
    setRecs([...recs, { email: e, name: name.trim() || e }])
    setSearch('')
  }
  const removeRec = (email: string) => setRecs(recs.filter((r) => r.email !== email))

  const unusedSuggestions = suggestions.filter((s) => !recs.find((r) => r.email === s.email))
  const filteredUsers = users.filter((u) =>
    !recs.find((r) => r.email === u.email) &&
    (u.email.toLowerCase().includes(search.toLowerCase()) || (u.full_name ?? '').toLowerCase().includes(search.toLowerCase())))

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
        <div className="text-xs font-semibold text-slate-700">Recommend reviewers <span className="font-normal text-slate-400">(optional — the Document Controller decides finally)</span></div>

        {recs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recs.map((r) => (
              <span key={r.email} className="flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-xs text-teal-800">
                {r.name}
                <button onClick={() => removeRec(r.email)} className="text-teal-500 hover:text-rose-600" title="Remove">✕</button>
              </span>
            ))}
          </div>
        )}

        {unusedSuggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unusedSuggestions.slice(0, 6).map((s) => (
              <button key={s.email} onClick={() => addRec(s.email, s.name)}
                className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800">
                + {s.name} <span className="text-slate-400">({s.reviewCount})</span>
              </button>
            ))}
          </div>
        )}

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a name or type a full email to add…"
          className="mt-2 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-300"
        />
        {search && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-100">
            {filteredUsers.slice(0, 8).map((u) => (
              <button key={u.email} onClick={() => addRec(u.email, u.full_name ?? u.email)}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs hover:bg-teal-50">
                <span className="font-medium text-slate-700">{u.full_name ?? u.email}</span>
                <span className="text-slate-400">{u.email} · {u.role}</span>
              </button>
            ))}
            {filteredUsers.length === 0 && search.includes('@') && (
              <button onClick={() => addRec(search, search)}
                className="w-full px-2.5 py-1.5 text-left text-xs text-teal-700 hover:bg-teal-50">
                Add “{search.trim()}” by email
              </button>
            )}
            {filteredUsers.length === 0 && !search.includes('@') && (
              <p className="px-2.5 py-1.5 text-xs text-slate-400">No match — type a full email to add directly.</p>
            )}
          </div>
        )}
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
