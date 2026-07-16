'use client'
import { useMemo, useState } from 'react'

export type CddlRow = {
  docno: string
  ppe_docno: string | null
  wbs: string | null
  discipline: string | null
  doc_type: string | null
  revision: string | null
  title: string | null
  area_facility: string | null
  broad_type: string | null
  rev_a_transmittal: string | null
  rev0_transmittal: string | null
  aconex_doc_status: string | null
  aconex_review_status: string | null
  pct_complete: number | null
  doc_owner: string | null
  doc_owner_initials: string | null
  comments: string | null
  due: string | null
  schedule_status: string | null
  package_code: string
}

// Review-status buckets for the summary cards (same lexicon as the review tracker).
const BUCKET = (r: CddlRow): BucketKey => {
  const rs = (r.aconex_review_status ?? '').toLowerCase()
  const ds = (r.aconex_doc_status ?? '').toUpperCase()
  if (rs.startsWith('approved') || rs.startsWith('acknowledged')) return 'APPROVED'
  if (rs.startsWith('terminated')) return 'TERMINATED'
  if (rs.startsWith('rejected') || rs.startsWith('reviewed')) return 'PPE_ACTION'
  if (rs === 'pending' && ds.startsWith('RES')) return 'PLACEHOLDER'
  if (rs === 'pending') return 'IN_REVIEW'
  return 'OTHER'
}
type BucketKey = 'APPROVED' | 'TERMINATED' | 'PPE_ACTION' | 'PLACEHOLDER' | 'IN_REVIEW' | 'OTHER'

export function CddlRegister({ rows }: { rows: CddlRow[] }) {
  const [q, setQ] = useState('')
  const [bucket, setBucket] = useState<'ALL' | BucketKey>('ALL')
  const [owner, setOwner] = useState('ALL')
  const [disc, setDisc] = useState('ALL')

  const owners = useMemo(
    () => Array.from(new Set(rows.map(r => r.doc_owner ?? '').filter(Boolean))).sort(),
    [rows],
  )
  const discs = useMemo(
    () => Array.from(new Set(rows.map(r => r.discipline ?? '').filter(Boolean))).sort(),
    [rows],
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length }
    for (const r of rows) { const b = BUCKET(r); c[b] = (c[b] ?? 0) + 1 }
    return c
  }, [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (bucket !== 'ALL' && BUCKET(r) !== bucket) return false
      if (owner !== 'ALL' && (r.doc_owner ?? '') !== owner) return false
      if (disc !== 'ALL' && (r.discipline ?? '') !== disc) return false
      if (needle && !(
        `${r.docno} ${r.ppe_docno ?? ''} ${r.title ?? ''} ${r.area_facility ?? ''} ${r.doc_owner ?? ''} ${r.comments ?? ''}`
          .toLowerCase().includes(needle)
      )) return false
      return true
    })
  }, [rows, bucket, owner, disc, q])

  const cards: Array<{ key: 'ALL' | BucketKey; label: string; n: number; accent: string }> = [
    { key: 'ALL',         label: 'All documents',            n: counts.ALL ?? 0,         accent: 'text-navy-700' },
    { key: 'PLACEHOLDER', label: 'Placeholders (not issued)', n: counts.PLACEHOLDER ?? 0, accent: 'text-purple-700' },
    { key: 'IN_REVIEW',   label: 'Issued — in review',       n: counts.IN_REVIEW ?? 0,   accent: 'text-amber-700' },
    { key: 'PPE_ACTION',  label: 'Returned — PPE action',    n: counts.PPE_ACTION ?? 0,  accent: 'text-rose-700' },
    { key: 'APPROVED',    label: 'Approved / acknowledged',  n: counts.APPROVED ?? 0,    accent: 'text-emerald-700' },
    { key: 'TERMINATED',  label: 'Terminated',               n: counts.TERMINATED ?? 0,  accent: 'text-slate-600' },
  ]

  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {cards.map(c => (
          <button
            key={c.key}
            onClick={() => setBucket(c.key)}
            className={`card p-4 text-left transition ${bucket === c.key ? 'ring-2 ring-navy-400' : 'hover:border-navy-300'}`}
          >
            <div className={`text-2xl font-bold ${c.accent}`}>{c.n}</div>
            <div className="text-xs text-slate-500 mt-0.5">{c.label}</div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search doc no, title, owner, comments…"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-navy-300"
        />
        <select value={owner} onChange={e => setOwner(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm max-w-64">
          <option value="ALL">All owners</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={disc} onChange={e => setDisc(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="ALL">All disciplines</option>
          {discs.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="text-xs text-slate-400 ml-auto">{shown.length} shown</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy-700 text-white text-left">
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Document No</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Title</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">WBS</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Disc.</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Rev</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Doc status</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Review status</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600 text-right">%</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Owner</th>
              <th className="px-3 py-2 font-semibold">Due</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 1500).map((r, i) => (
              <tr key={r.docno + i} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" title={r.ppe_docno ?? ''}>{r.docno}</td>
                <td className="px-3 py-2 text-slate-700 max-w-md" title={r.comments ?? ''}>{r.title}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.wbs}</td>
                <td className="px-3 py-2 text-slate-500">{r.discipline}</td>
                <td className="px-3 py-2 text-slate-500">{r.revision}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{(r.aconex_doc_status ?? '').split(' - ')[0]}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.aconex_review_status}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pct(r.pct_complete)}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.doc_owner ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.due ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 1500 && (
          <p className="px-3 py-2 text-xs text-slate-400">
            Showing the first 1,500 of {shown.length.toLocaleString()} — narrow with search or the filters.
          </p>
        )}
      </div>
    </div>
  )
}
