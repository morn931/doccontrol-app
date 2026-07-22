'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getAvailablePlaceholders, bookPlaceholder, type Placeholder } from '../requests/actions'

/**
 * The Drawing Number Picker — a pre-check atop "Request a document number".
 * A title/number search + four combinable, cascading dropdowns (Package · WBS ·
 * Discipline · Type) over the existing placeholder numbers (from the Aconex Review
 * Tracker). Book one out (it becomes an assigned request, ready to upload against);
 * only if none fits does the requester unlock the new-number form below.
 */
type Facets = { package_code: string; wbs: string; discipline: string; doc_type: string }
const EMPTY: Facets = { package_code: '', wbs: '', discipline: '', doc_type: '' }
const FACET_KEYS: (keyof Facets)[] = ['package_code', 'wbs', 'discipline', 'doc_type']

export default function NumberPicker({ onConfirmNone, confirmed }: { onConfirmNone: () => void; confirmed: boolean }) {
  const router = useRouter()
  const [all, setAll] = useState<Placeholder[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [f, setF] = useState<Facets>(EMPTY)
  const [busy, startBusy] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    getAvailablePlaceholders().then(setAll).catch(() => setMsg('Could not load placeholder numbers.')).finally(() => setLoading(false))
  }, [])

  const matchText = (p: Placeholder) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    const hay = `${p.title ?? ''} ${p.docno}`.toLowerCase()
    return needle.split(/\s+/).every((t) => hay.includes(t))
  }
  const matchFacets = (p: Placeholder, except?: keyof Facets) => {
    for (const k of FACET_KEYS) {
      if (k === except) continue
      if (f[k] && ((p[k as keyof Placeholder] as string | null) ?? '') !== f[k]) return false
    }
    return true
  }

  const shown = useMemo(
    () => all.filter((p) => matchText(p) && matchFacets(p)),
    [all, q, f], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Cascading options — each dropdown offers values still reachable given the OTHER filters.
  const optsFor = (field: keyof Facets) => {
    const vals = all
      .filter((p) => matchText(p) && matchFacets(p, field))
      .map((p) => ((p[field as keyof Placeholder] as string | null) ?? '') as string)
      .filter(Boolean)
    return [...new Set(vals)].sort()
  }
  const pkgOpts  = useMemo(() => optsFor('package_code'), [all, q, f]) // eslint-disable-line react-hooks/exhaustive-deps
  const wbsOpts  = useMemo(() => optsFor('wbs'),          [all, q, f]) // eslint-disable-line react-hooks/exhaustive-deps
  const discOpts = useMemo(() => optsFor('discipline'),   [all, q, f]) // eslint-disable-line react-hooks/exhaustive-deps
  const typeOpts = useMemo(() => optsFor('doc_type'),     [all, q, f]) // eslint-disable-line react-hooks/exhaustive-deps

  const book = (docno: string) => {
    setMsg(null)
    startBusy(async () => {
      const r = await bookPlaceholder(docno)
      if (r.ok && r.requestId) router.push(`/documents/requests/${r.requestId}`)
      else setMsg(r.error ?? 'Could not book that number.')
    })
  }

  const anyFilter = !!(q.trim() || f.package_code || f.wbs || f.discipline || f.doc_type)
  const Dropdown = (label: string, field: keyof Facets, options: string[]) => (
    <select
      value={f[field]}
      onChange={(e) => setF((prev) => ({ ...prev, [field]: e.target.value }))}
      className="rounded-lg border border-teal-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-300"
    >
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-teal-900">First — check for an existing number</h2>
          <p className="text-xs text-slate-500">
            Many numbers already exist as placeholders. Filter below; if one fits, <b>book it out</b> and use it — it drops
            straight into your requests, ready to upload against. Only if none fits do you request a new number.
          </p>
        </div>
        <span className="text-xs text-slate-400">{loading ? 'loading…' : `${shown.length} of ${all.length}`}</span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the title or number…"
        className="mt-3 w-full rounded-lg border border-teal-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {Dropdown('Package', 'package_code', pkgOpts)}
        {Dropdown('WBS', 'wbs', wbsOpts)}
        {Dropdown('Discipline', 'discipline', discOpts)}
        {Dropdown('Type', 'doc_type', typeOpts)}
        {anyFilter && (
          <button onClick={() => { setQ(''); setF(EMPTY) }} className="text-xs font-medium text-teal-700 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <p className="p-3 text-xs text-slate-400">Loading placeholder numbers…</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-xs text-slate-400">No matching placeholder numbers{anyFilter ? ' for these filters' : ''}.</p>
        ) : (
          shown.slice(0, 300).map((p) => (
            <div key={p.docno} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-slate-800">{p.docno}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {p.title ?? '—'}
                  {p.discipline ? ` · ${p.discipline}` : ''}{p.doc_type ? ` · ${p.doc_type}` : ''}
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
        {!loading && shown.length > 300 && (
          <p className="p-2 text-center text-[11px] text-slate-400">Showing first 300 — narrow the filters.</p>
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
