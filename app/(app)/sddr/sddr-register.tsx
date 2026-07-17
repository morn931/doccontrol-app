'use client'
import { useMemo, useState } from 'react'

export type SddrRow = {
  docno: string
  package_code: string
  wbs: string | null
  discipline: string | null
  doc_type: string | null
  revision: string | null
  sheet: string | null
  area_facility: string | null
  major_desc: string | null
  broad_type: string | null
  title: string | null
  due: string | null
  doc_owner: string | null
  ifr_transmittal: string | null
  ifc_transmittal: string | null
  ppe_doc_status: string | null
  pct_complete: number | null
  as_built: string | null
  cert_final: string | null
  tag_no: string | null
  comments: string | null
  issued_for: string | null
  sub_supplier: string | null
  activity_id: string | null
  vendor_doc_id: string | null
}

// fixed vendor order + labels for the package tabs
const PKG_ORDER = ['E102', 'E511B', 'E516B', 'K125', 'K137', 'E123', 'E113']
const PKG_LABELS: Record<string, string> = {
  E102: 'E102 · SynCons (ABB)',
  E511B: 'E511B · Transformers (ABB)',
  E516B: 'E516B · E-Rooms (ABB)',
  K125: 'K125 · Substations (Siemens)',
  K137: 'K137 · OHL (PSI)',
  E123: 'E123 · Loadbanks (Crestchic)',
  E113: 'E113 · Fuel Tanks (Fuelco)',
}

type Bucket = 'ALL' | 'APPROVED' | 'REVIEWED' | 'OPEN' | 'OVERDUE'

const status = (r: SddrRow) => (r.ppe_doc_status ?? '').trim().toLowerCase()
const isOverdue = (r: SddrRow, today: string) =>
  !!r.due && r.due < today && status(r) !== 'approved'

export function SddrRegister({ rows }: { rows: SddrRow[] }) {
  const [pkgSel, setPkgSel] = useState('E102')
  const [bucket, setBucket] = useState<Bucket>('ALL')
  const [q, setQ] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  const pkgs = useMemo(() => {
    const present = new Set(rows.map(r => r.package_code))
    const ordered = PKG_ORDER.filter(p => present.has(p))
    return [...ordered, ...Array.from(present).filter(p => !PKG_ORDER.includes(p)).sort()]
  }, [rows])
  const pkg = pkgs.includes(pkgSel) ? pkgSel : (pkgs[0] ?? 'E102')

  const active = useMemo(() => rows.filter(r => r.package_code === pkg), [rows, pkg])

  const counts = useMemo(() => {
    const c = { ALL: active.length, APPROVED: 0, REVIEWED: 0, OPEN: 0, OVERDUE: 0 }
    for (const r of active) {
      const s = status(r)
      if (s === 'approved') c.APPROVED += 1
      else if (s.startsWith('reviewed') || s.startsWith('rejected')) c.REVIEWED += 1
      else c.OPEN += 1
      if (isOverdue(r, today)) c.OVERDUE += 1
    }
    return c
  }, [active, today])

  const avgPct = useMemo(() => {
    const vals = active.map(r => r.pct_complete).filter((v): v is number => v != null)
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) : null
  }, [active])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return active.filter(r => {
      const s = status(r)
      if (bucket === 'APPROVED' && s !== 'approved') return false
      if (bucket === 'REVIEWED' && !(s.startsWith('reviewed') || s.startsWith('rejected'))) return false
      if (bucket === 'OPEN' && (s === 'approved' || s.startsWith('reviewed') || s.startsWith('rejected'))) return false
      if (bucket === 'OVERDUE' && !isOverdue(r, today)) return false
      if (needle && !(
        `${r.docno} ${r.title ?? ''} ${r.major_desc ?? ''} ${r.doc_owner ?? ''} ${r.sub_supplier ?? ''} ${r.comments ?? ''}`
          .toLowerCase().includes(needle)
      )) return false
      return true
    })
  }, [active, bucket, q, today])

  const cards: Array<{ key: Bucket; label: string; n: number; accent: string }> = [
    { key: 'ALL',      label: 'All documents',            n: counts.ALL,      accent: 'text-navy-700' },
    { key: 'OPEN',     label: 'Open / not yet reviewed',  n: counts.OPEN,     accent: 'text-amber-700' },
    { key: 'REVIEWED', label: 'Reviewed / to resubmit',   n: counts.REVIEWED, accent: 'text-rose-700' },
    { key: 'APPROVED', label: 'Approved',                 n: counts.APPROVED, accent: 'text-emerald-700' },
    { key: 'OVERDUE',  label: 'Past due (not approved)',  n: counts.OVERDUE,  accent: 'text-red-700' },
  ]

  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <div className="space-y-4">
      {/* Vendor tabs */}
      <div className="flex gap-1 border-b border-slate-200 flex-wrap">
        {pkgs.map(p => (
          <button
            key={p}
            onClick={() => { setPkgSel(p); setBucket('ALL') }}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition ${
              p === pkg
                ? 'bg-white border-slate-200 text-navy-800 -mb-px'
                : 'bg-slate-50 border-transparent text-slate-500 hover:text-navy-700'
            }`}
          >
            {PKG_LABELS[p] ?? p}
          </button>
        ))}
      </div>

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
        <div className="card p-4">
          <div className="text-2xl font-bold text-sky-700">{avgPct == null ? '—' : `${avgPct}%`}</div>
          <div className="text-xs text-slate-500 mt-0.5">Avg % complete</div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search doc no, title, owner, sub-supplier…"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-navy-300"
        />
        {bucket !== 'ALL' && (
          <button onClick={() => setBucket('ALL')} className="text-xs text-navy-600 hover:underline">
            Clear filter
          </button>
        )}
        <span className="text-xs text-slate-400 ml-auto">{shown.length} shown</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy-700 text-white text-left">
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Document No</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Title</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Disc.</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Rev</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">PPE status</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600 text-right">%</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Due</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">IFR sent</th>
              <th className="px-3 py-2 font-semibold">Vendor owner</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 1500).map((r, i) => (
              <tr key={r.docno + i} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" title={r.vendor_doc_id ?? ''}>{r.docno}</td>
                <td className="px-3 py-2 text-slate-700 max-w-md" title={r.comments ?? ''}>{r.title ?? r.major_desc}</td>
                <td className="px-3 py-2 text-slate-500">{r.discipline}</td>
                <td className="px-3 py-2 text-slate-500">{r.revision}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.ppe_doc_status ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pct(r.pct_complete)}</td>
                <td className={`px-3 py-2 whitespace-nowrap ${isOverdue(r, today) ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                  {r.due ?? '—'}
                </td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.ifr_transmittal ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap" title={r.sub_supplier ?? ''}>{r.doc_owner ?? '—'}</td>
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
