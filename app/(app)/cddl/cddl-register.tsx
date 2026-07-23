'use client'
import { useMemo, useState, useTransition } from 'react'
import { updateCddlDoc, addCddlDoc, retireCddlDoc, setCddlMode } from './actions'

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
  activity_id: string | null
  main_group: string | null
  sub_group: string | null
  bh: string | null
  drawing_pack: string | null
  retired?: boolean | null
  package_code: string
  planned_hours?: number | null   // derived from the hour estimator (read-time; not synced)
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

// The manually-managed fields (Aconex statuses + % ladder come from the daily sync).
const EDIT_FIELDS: Array<{ key: keyof CddlRow & string; label: string; wide?: boolean }> = [
  { key: 'title', label: 'Full title', wide: true },
  { key: 'ppe_docno', label: 'PPE doc number' },
  { key: 'doc_owner_initials', label: 'Doc owner (initials)' },
  { key: 'due', label: 'Due date' },
  { key: 'schedule_status', label: 'Schedule status' },
  { key: 'activity_id', label: 'Activity ID (P6)' },
  { key: 'wbs', label: 'Area / WBS' },
  { key: 'discipline', label: 'Discipline' },
  { key: 'main_group', label: 'Main group' },
  { key: 'sub_group', label: 'Sub group' },
  { key: 'bh', label: 'BH' },
  { key: 'drawing_pack', label: 'Drawing pack' },
  { key: 'rev_a_transmittal', label: 'Rev A transmittal' },
  { key: 'rev0_transmittal', label: 'Rev 0 transmittal' },
  { key: 'comments', label: 'Comments', wide: true },
]

const PKG_LABELS: Record<string, string> = { K124: 'Phase 1 (K124)', K038: 'Early Works (K038)' }

export function CddlRegister({ rows, canEdit, mode }: { rows: CddlRow[]; canEdit: boolean; mode: string }) {
  const [q, setQ] = useState('')
  const [pkgSel, setPkgSel] = useState('K124')
  const [bucket, setBucket] = useState<'ALL' | BucketKey>('ALL')
  const [owner, setOwner] = useState('ALL')
  const [disc, setDisc] = useState('ALL')
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<CddlRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  const [pending, startTransition] = useTransition()

  const coreflowMaster = mode === 'coreflow_master'
  const editable = canEdit && coreflowMaster

  const pkgs = useMemo(() => Array.from(new Set(rows.map(r => r.package_code))).sort(), [rows])
  const pkg = pkgs.includes(pkgSel) ? pkgSel : (pkgs[0] ?? 'K124')
  const active = useMemo(
    () => rows.filter(r => r.package_code === pkg && (showRetired || !r.retired)),
    [rows, pkg, showRetired],
  )
  const owners = useMemo(() => Array.from(new Set(active.map(r => r.doc_owner ?? '').filter(Boolean))).sort(), [active])
  const discs = useMemo(() => Array.from(new Set(active.map(r => r.discipline ?? '').filter(Boolean))).sort(), [active])

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: active.length }
    for (const r of active) { const b = BUCKET(r); c[b] = (c[b] ?? 0) + 1 }
    return c
  }, [active])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return active.filter(r => {
      if (bucket !== 'ALL' && BUCKET(r) !== bucket) return false
      if (owner !== 'ALL' && (r.doc_owner ?? '') !== owner) return false
      if (disc !== 'ALL' && (r.discipline ?? '') !== disc) return false
      if (needle && !(
        `${r.docno} ${r.ppe_docno ?? ''} ${r.title ?? ''} ${r.area_facility ?? ''} ${r.doc_owner ?? ''} ${r.comments ?? ''}`
          .toLowerCase().includes(needle)
      )) return false
      return true
    })
  }, [active, bucket, owner, disc, q])

  const cards: Array<{ key: 'ALL' | BucketKey; label: string; n: number; accent: string }> = [
    { key: 'ALL',         label: 'All documents',             n: counts.ALL ?? 0,         accent: 'text-navy-700' },
    { key: 'PLACEHOLDER', label: 'Placeholders (not issued)', n: counts.PLACEHOLDER ?? 0, accent: 'text-purple-700' },
    { key: 'IN_REVIEW',   label: 'Issued — in review',        n: counts.IN_REVIEW ?? 0,   accent: 'text-amber-700' },
    { key: 'PPE_ACTION',  label: 'Returned — PPE action',     n: counts.PPE_ACTION ?? 0,  accent: 'text-rose-700' },
    { key: 'APPROVED',    label: 'Approved / acknowledged',   n: counts.APPROVED ?? 0,    accent: 'text-emerald-700' },
    { key: 'TERMINATED',  label: 'Terminated',                n: counts.TERMINATED ?? 0,  accent: 'text-slate-600' },
  ]

  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
  const plannedOf = (r: CddlRow) => r.planned_hours ?? 0
  const earnedOf = (r: CddlRow) => plannedOf(r) * (r.pct_complete ?? 0)
  const hrs = (v: number) => (v ? v.toLocaleString('en-ZA', { maximumFractionDigits: 0 }) : '—')

  // Hours roll-up across the current (filtered) view.
  const totals = useMemo(() => {
    let planned = 0, earned = 0
    for (const r of shown) { planned += plannedOf(r); earned += earnedOf(r) }
    return { planned, earned, pct: planned ? earned / planned : 0 }
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const r = await fn()
      setMsg(r.ok ? '' : (r.error ?? 'Failed'))
      if (r.ok) { setEditing(null); setAdding(false) }
    })

  return (
    <div className="space-y-4">
      {/* Mode banner + cut-over switch */}
      <div className={`rounded-lg border px-4 py-2.5 text-sm flex items-center gap-3 flex-wrap ${coreflowMaster ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        {coreflowMaster ? (
          <>✅ <b>Coreflow is master.</b> Document Control edits the CDDL here; the daily sync refreshes Aconex statuses only.</>
        ) : (
          <>📗 <b>The Excel workbook is master.</b> This register mirrors it daily (read-only). If the workbook is lost or you are ready to cut over, switch to Coreflow-managed.</>
        )}
        {canEdit && (
          <button
            disabled={pending}
            onClick={() => {
              const target = coreflowMaster ? 'excel_master' : 'coreflow_master'
              const warn = coreflowMaster
                ? 'Switch BACK to Excel-master? The next daily sync will OVERWRITE all in-app edits with the workbook.'
                : 'Make Coreflow the master? The daily sync stops mirroring the workbook and refreshes Aconex statuses only. In-app editing unlocks.'
              if (confirm(warn)) run(() => setCddlMode(target as 'excel_master' | 'coreflow_master'))
            }}
            className="ml-auto rounded-lg border border-current px-3 py-1 text-xs font-medium hover:opacity-80"
          >
            {coreflowMaster ? 'Revert to Excel-master' : 'Switch to Coreflow-managed'}
          </button>
        )}
      </div>
      {msg && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{msg}</div>}

      {pkgs.length > 1 && (
        <div className="flex gap-1 border-b border-slate-200">
          {pkgs.map(p => (
            <button
              key={p}
              onClick={() => setPkgSel(p)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition ${
                p === pkg
                  ? 'bg-white border-slate-200 text-navy-800 -mb-px'
                  : 'bg-slate-50 border-transparent text-slate-500 hover:text-navy-700'
              }`}
            >
              {PKG_LABELS[p] ?? p}
            </button>
          ))}
        </div>
      )}

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
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} className="rounded border-slate-300" />
          Show retired
        </label>
        {editable && (
          <button onClick={() => setAdding(true)}
            className="rounded-lg bg-navy-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-600">
            + Add document
          </button>
        )}
        <a href={`/api/cddl/export?pkg=${pkg}`}
          className="rounded-lg border border-navy-300 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-50">
          ⬇ Export to Excel (CDDL format)
        </a>
        <span className="ml-auto text-xs text-slate-500">
          <b className="text-teal-700">{hrs(totals.earned)} h</b> earned of {hrs(totals.planned)} h planned
          <span className="text-slate-400"> ({Math.round(totals.pct * 100)}%)</span>
          <span className="mx-2 text-slate-300">·</span>
          {shown.length} shown
        </span>
      </div>
      <p className="-mt-1 text-[11px] text-slate-400">
        Planned hours are estimated per document from its discipline + doc-type (RDMC resource model, calibrated to 69,116 h).
        Earned = Planned × %. Derived live — the daily 06:00 sync never overrides them.
      </p>

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
              <th className="px-3 py-2 font-semibold border-r border-navy-600 text-right">Planned h</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600 text-right">%</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600 text-right">Earned h</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Owner</th>
              <th className="px-3 py-2 font-semibold border-r border-navy-600">Due</th>
              {editable && <th className="px-3 py-2 font-semibold"></th>}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 1500).map((r, i) => (
              <tr key={r.docno + i} className={`border-b border-slate-100 hover:bg-slate-50 align-top ${r.retired ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" title={r.ppe_docno ?? ''}>{r.docno}</td>
                <td className="px-3 py-2 text-slate-700 max-w-md" title={r.comments ?? ''}>{r.title}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.wbs}</td>
                <td className="px-3 py-2 text-slate-500">{r.discipline}</td>
                <td className="px-3 py-2 text-slate-500">{r.revision}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{(r.aconex_doc_status ?? '').split(' - ')[0]}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.aconex_review_status}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{hrs(plannedOf(r))}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pct(r.pct_complete)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-teal-700">{hrs(earnedOf(r))}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.doc_owner ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.due ?? '—'}</td>
                {editable && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => setEditing(r)} className="text-navy-600 hover:underline text-xs">✎ Edit</button>
                  </td>
                )}
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

      {(editing || adding) && (
        <EditDialog
          row={editing}
          pending={pending}
          onCancel={() => { setEditing(null); setAdding(false); setMsg('') }}
          onSave={(values) => {
            if (editing) run(() => updateCddlDoc(editing.docno, values))
            else run(() => addCddlDoc({ ...values, package_code: pkg }))
          }}
          onRetire={editing ? (retired) => run(() => retireCddlDoc(editing.docno, retired)) : undefined}
        />
      )}
    </div>
  )
}

function EditDialog({ row, pending, onCancel, onSave, onRetire }: {
  row: CddlRow | null
  pending: boolean
  onCancel: () => void
  onSave: (values: Record<string, string | null>) => void
  onRetire?: (retired: boolean) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const f of EDIT_FIELDS) v[f.key] = (row?.[f.key] as string | null) ?? ''
    if (!row) v.docno = ''
    return v
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="card w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 space-y-4 bg-white" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-navy-800">
          {row ? <>Edit <span className="font-mono text-sm">{row.docno}</span></> : 'Add document (placeholder)'}
        </h3>
        {!row && (
          <label className="block text-xs text-slate-500">
            RDMC document number *
            <input value={values.docno} onChange={e => setValues(v => ({ ...v, docno: e.target.value }))}
              placeholder="6105AK124-…" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-mono" />
          </label>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EDIT_FIELDS.map(f => (
            <label key={f.key} className={`block text-xs text-slate-500 ${f.wide ? 'sm:col-span-2' : ''}`}>
              {f.label}
              <input value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button disabled={pending}
            onClick={() => onSave(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() || null])))}
            className="rounded-lg bg-navy-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-600 disabled:opacity-50">
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-600">Cancel</button>
          {onRetire && row && (
            <button disabled={pending} onClick={() => onRetire(!row.retired)}
              className="ml-auto rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50">
              {row.retired ? 'Restore (un-retire)' : 'Retire (move to not-in-use)'}
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          Aconex doc/review status, revision and % complete are refreshed automatically from Aconex by the daily sync — they are not edited here.
          Every change is audit-logged.
        </p>
      </div>
    </div>
  )
}
