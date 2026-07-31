'use client'
// Aconex Issue Queue — the tracked-manual exit that closes the document-control
// loop: every internal (Rev 0/IFC) and As-Built document that passed review
// lines up here; Doc Control uploads to Aconex as always, then records the
// transmittal reference (+ the CDDL/MDDR-updated tick) against the selection.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import { CheckCircle, Send, RefreshCw, FileText } from 'lucide-react'

type Row = {
  id: string; batch_id: string | null; document_version_id: string | null
  source: string; rdmc_document_number: string | null; revision: string | null
  aconex_document_ref: string | null; cddl_updated: boolean
  issued_by_email: string | null; issued_at: string | null
  status: 'pending' | 'issued'; notes: string | null; created_at: string
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  internal: { label: 'IFC / Rev 0', cls: 'bg-teal-100 text-teal-700' },
  asbuilt:  { label: '📐 AS-BUILT', cls: 'bg-indigo-100 text-indigo-700' },
  redline:  { label: '✏ Redline',  cls: 'bg-red-100 text-red-700' },
  vendor:   { label: 'Vendor',     cls: 'bg-slate-100 text-slate-600' },
}

export default function AconexIssuePage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'issued'>('pending')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [aconexRef, setAconexRef] = useState('')
  const [cddl, setCddl] = useState(true)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const res = await fetch('/api/aconex-issue')
    if (res.ok) setRows((await res.json()).rows ?? [])
    setLoading(false)
  }

  const view = useMemo(() => rows.filter(r => r.status === tab), [rows, tab])
  const pendingCount = rows.filter(r => r.status === 'pending').length

  function toggle(id: string) {
    setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSel(s => s.size === view.length ? new Set() : new Set(view.map(r => r.id)))
  }

  async function markIssued() {
    setError(''); setMsg('')
    if (!sel.size) { setError('Select the documents covered by the Aconex transmittal.'); return }
    if (!aconexRef.trim()) { setError('Enter the Aconex transmittal / document reference.'); return }
    setBusy(true)
    const res = await fetch('/api/aconex-issue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...sel], aconexRef, cddlUpdated: cddl, notes }),
    })
    const d = await res.json()
    setBusy(false)
    if (!res.ok) { setError(d.error ?? 'Failed'); return }
    setMsg(`${d.issued} document${d.issued !== 1 ? 's' : ''} recorded as issued to Aconex under ${aconexRef.trim()}.`)
    setSel(new Set()); setAconexRef(''); setNotes('')
    await load()
  }

  async function backfill() {
    setBusy(true); setError(''); setMsg('')
    const res = await fetch('/api/aconex-issue/backfill', { method: 'POST' })
    const d = await res.json()
    setBusy(false)
    if (!res.ok) { setError(d.error ?? 'Failed'); return }
    setMsg(d.added ? `Added ${d.added} document(s) from ${d.batches} completed batch(es) that weren't queued yet.` : 'Nothing missing — the queue is complete.')
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Aconex Issue Queue</h1>
          <p className="text-slate-500 text-sm mt-1">
            Reviewed Rev 0 / IFC and As-Built documents waiting to be uploaded to Aconex.
            Upload in Aconex as usual, then record the transmittal reference here — that closes the loop, with evidence.
          </p>
        </div>
        <button onClick={backfill} disabled={busy} className="btn-secondary text-xs py-1.5 px-3">
          <RefreshCw className="h-3.5 w-3.5" /> Scan for missed batches
        </button>
      </div>

      <div className="flex gap-2">
        {(['pending', 'issued'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSel(new Set()) }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              tab === t ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {t === 'pending' ? `Awaiting issue (${pendingCount})` : `Issued (${rows.length - pendingCount})`}
          </button>
        ))}
      </div>

      {msg && <div className="card p-3 bg-green-50 border-green-200 text-emerald-800 text-sm flex items-center gap-2"><CheckCircle className="h-4 w-4" /> {msg}</div>}
      {error && <div className="card p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

      {/* Mark-issued bar */}
      {tab === 'pending' && sel.size > 0 && (
        <div className="card p-4 bg-sky-50 border-sky-200 space-y-2">
          <p className="text-sm font-semibold text-sky-900">{sel.size} document{sel.size !== 1 ? 's' : ''} selected — record the Aconex issue:</p>
          <div className="flex flex-wrap gap-2 items-center">
            <input value={aconexRef} onChange={e => setAconexRef(e.target.value)}
              placeholder="Aconex transmittal / doc ref, e.g. PPET-TN-000123" className="input max-w-xs text-sm" />
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes (optional)" className="input max-w-xs text-sm" />
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={cddl} onChange={e => setCddl(e.target.checked)} />
              CDDL / MDDR updated
            </label>
            <button onClick={markIssued} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              <Send className="h-4 w-4" /> {busy ? 'Recording…' : 'Mark issued to Aconex'}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {tab === 'pending' && (
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={view.length > 0 && sel.size === view.length} onChange={toggleAll} />
                </th>
              )}
              <th className="px-3 py-2.5">Document</th>
              <th className="px-3 py-2.5">Rev</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">{tab === 'pending' ? 'Completed' : 'Issued'}</th>
              {tab === 'issued' && <th className="px-3 py-2.5">Aconex ref</th>}
              {tab === 'issued' && <th className="px-3 py-2.5">CDDL</th>}
              {tab === 'issued' && <th className="px-3 py-2.5">By</th>}
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            ) : view.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                {tab === 'pending' ? 'Nothing waiting — every reviewed document has been issued to Aconex.' : 'Nothing issued yet.'}
              </td></tr>
            ) : view.map(r => {
              const badge = SOURCE_BADGE[r.source] ?? SOURCE_BADGE.vendor
              return (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  {tab === 'pending' && (
                    <td className="px-3 py-2.5"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  )}
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{r.rdmc_document_number ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{r.revision ?? '—'}</td>
                  <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>{badge.label}</span></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-500">
                    {tab === 'pending'
                      ? formatDistanceToNow(new Date(r.created_at), { addSuffix: true })
                      : r.issued_at ? format(new Date(r.issued_at), 'd MMM yyyy') : '—'}
                  </td>
                  {tab === 'issued' && <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{r.aconex_document_ref ?? '—'}</td>}
                  {tab === 'issued' && <td className="px-3 py-2.5 text-xs">{r.cddl_updated ? '✅' : '—'}</td>}
                  {tab === 'issued' && <td className="px-3 py-2.5 text-xs text-slate-500">{r.issued_by_email ?? '—'}</td>}
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {r.document_version_id && (
                      <a href={`/api/documents/${r.document_version_id}/file`} target="_blank" rel="noreferrer"
                        className="text-xs text-teal-700 hover:underline">view</a>
                    )}
                    {r.batch_id && (
                      <Link href={`/batches/${r.batch_id}`} className="ml-3 text-xs text-slate-500 hover:underline">batch</Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
