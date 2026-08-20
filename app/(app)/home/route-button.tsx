'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CornerUpRight, Check, Loader2, Search } from 'lucide-react'
import { routeItem } from './routing-actions'

export type Reviewer = { email: string; name: string }

// A compact "route to a reviewer" popover — pick a colleague, add an optional
// note, and hand this document (or the whole batch) to them.
export default function RouteButton({
  documentVersionId, batchId, documentNumber, packageCode, reviewers, kind, label,
}: {
  documentVersionId?: string | null
  batchId?: string | null
  documentNumber?: string | null
  packageCode?: string | null
  reviewers: Reviewer[]
  kind: 'doc' | 'batch'
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Reviewer | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s ? reviewers.filter((r) => r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s)) : reviewers
    return list.slice(0, 8)
  }, [q, reviewers])

  async function submit() {
    if (!sel || busy) return
    setBusy(true); setErr(null)
    const r = await routeItem({
      toEmail: sel.email, toName: sel.name,
      documentVersionId: documentVersionId ?? null, batchId: batchId ?? null,
      documentNumber: documentNumber ?? null, packageCode: packageCode ?? null, note,
    })
    setBusy(false)
    if (r.ok) {
      setDone(sel.name)
      setTimeout(() => { setOpen(false); setDone(null); setSel(null); setNote(''); setQ(''); router.refresh() }, 1100)
    } else setErr(r.error ?? 'Could not route')
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        title={kind === 'batch' ? 'Route the whole batch to a reviewer' : 'Route this document to a reviewer'}
        className={label
          ? 'inline-flex items-center gap-1 text-xs font-bold text-violet-700 hover:text-violet-900'
          : 'grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-400 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'}
      >
        <CornerUpRight className="h-3.5 w-3.5" />{label}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {done ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm font-semibold text-emerald-700">
              <Check className="h-4 w-4" /> Routed to {done}
            </div>
          ) : (
            <>
              <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Route {kind === 'batch' ? 'this batch' : 'this document'} to
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a reviewer…"
                  className="w-full bg-transparent py-1.5 text-sm outline-none" autoFocus />
              </div>
              <div className="mt-1 max-h-40 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-slate-400">No matches</div>
                ) : filtered.map((r) => (
                  <button key={r.email} type="button" onClick={() => setSel(r)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${sel?.email === r.email ? 'bg-violet-50 text-violet-800' : 'text-slate-700 hover:bg-slate-50'}`}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy-100 text-[10px] font-bold text-navy-700">
                      {r.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <span className="min-w-0"><span className="block truncate">{r.name}</span></span>
                    {sel?.email === r.email && <Check className="ml-auto h-4 w-4 text-violet-600" />}
                  </button>
                ))}
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="Add a note (optional) — e.g. can you sanity-check the earthing?"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-300" />
              {err && <div className="px-1 py-1 text-xs text-rose-600">{err}</div>}
              <button type="button" onClick={submit} disabled={!sel || busy}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerUpRight className="h-4 w-4" />}
                {busy ? 'Routing…' : sel ? `Route to ${sel.name.split(' ')[0]}` : 'Pick a reviewer'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
