'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getAvailablePlaceholders, bookPlaceholder, type Placeholder } from '../requests/actions'

/**
 * The Drawing Number Picker — sits atop "Request a document number" as a pre-check.
 * Search the existing placeholder numbers (from the Aconex Review Tracker); if one fits,
 * book it out (it becomes an assigned request, ready to upload against). Only if none fit
 * does the requester confirm and unlock the new-number form below.
 */
export default function NumberPicker({ onConfirmNone, confirmed }: { onConfirmNone: () => void; confirmed: boolean }) {
  const router = useRouter()
  const [all, setAll] = useState<Placeholder[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [busy, startBusy] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    getAvailablePlaceholders().then(setAll).catch(() => setMsg('Could not load placeholder numbers.')).finally(() => setLoading(false))
  }, [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    const terms = needle.split(/\s+/)
    return all.filter((p) => {
      const hay = `${p.docno} ${p.title ?? ''} ${p.discipline ?? ''} ${p.doc_type ?? ''}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [all, q])

  const book = (docno: string) => {
    setMsg(null)
    startBusy(async () => {
      const r = await bookPlaceholder(docno)
      if (r.ok && r.requestId) router.push(`/documents/requests/${r.requestId}`)
      else setMsg(r.error ?? 'Could not book that number.')
    })
  }

  return (
    <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-teal-900">First — check for an existing number</h2>
          <p className="text-xs text-slate-500">
            Many numbers already exist as placeholders. Search below; if one fits, <b>book it out</b> and use it — it drops
            straight into your requests, ready to upload against. Only if none fits do you request a new number.
          </p>
        </div>
        <span className="text-xs text-slate-400">{loading ? 'loading…' : `${shown.length} available`}</span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by description, discipline, WBS or number…"
        className="mt-3 w-full rounded-lg border border-teal-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
      />

      <div className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <p className="p-3 text-xs text-slate-400">Loading placeholder numbers…</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-xs text-slate-400">No matching placeholder numbers{q ? ' for that search' : ''}.</p>
        ) : (
          shown.slice(0, 200).map((p) => (
            <div key={p.docno} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-slate-800">{p.docno}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {p.title ?? '—'}{p.discipline ? ` · ${p.discipline}` : ''}
                </div>
              </div>
              <button
                onClick={() => book(p.docno)}
                disabled={busy}
                className="shrink-0 rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                Book out
              </button>
            </div>
          ))
        )}
        {!loading && shown.length > 200 && (
          <p className="p-2 text-center text-[11px] text-slate-400">Showing first 200 — refine your search.</p>
        )}
      </div>

      {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Found one? <b>Book out</b> — no need to request a new number.</p>
        {confirmed ? (
          <span className="text-xs font-medium text-emerald-700">✓ Requesting a new number below</span>
        ) : (
          <button
            onClick={onConfirmNone}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            None of these fit — request a new number →
          </button>
        )}
      </div>
    </div>
  )
}
