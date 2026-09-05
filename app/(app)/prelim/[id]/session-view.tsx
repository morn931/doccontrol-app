'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Download, Send, Lock, Unlock, ExternalLink, ShieldCheck, ChevronDown, ChevronRight, FileDown } from 'lucide-react'
import FolderBrowser, { type BrowseItem } from '../folder-browser'

type Session = { id: string; title: string; area: string | null; held_on: string | null; attendees: string | null; notes: string | null; status: 'open' | 'closed'; source_site_url: string; source_library: string; source_folder: string; created_by_name: string | null; created_by_email: string }
type Issue = { code: string; severity: 'major' | 'minor'; page: number | null; description: string; fix: string }
type Doc = { id: string; document_number: string | null; revision: string | null; title: string | null; discipline: string | null; document_type: string | null; source_file_name: string; source_file_url: string; cddl_doc_id: string | null; commentCount: number; unsavedMarks: boolean; markup_committed_at: string | null; outcome: 'pending' | 'ready' | 'rework' | 'withdrawn'; outcome_note: string | null; outcome_by_email: string | null; rework_to_email: string | null; handed_over_batch_id: string | null; handed_over_at: string | null; qualityIssues: Issue[] | null; qualityOverall: 'pass' | 'issues' | null; quality_open: number | null; quality_checked_at: string | null; quality_source_modified_at: string | null }

const OUTCOME_PILL: Record<Doc['outcome'], string> = {
  pending:   'bg-slate-100 text-slate-600',
  ready:     'bg-emerald-100 text-emerald-700',
  rework:    'bg-amber-100 text-amber-800',
  withdrawn: 'bg-red-100 text-red-700',
}

export default function SessionView({ session, docs, canManage }: { session: Session; docs: Doc[]; canManage: boolean }) {
  const router = useRouter()
  const open = session.status === 'open'
  const [path, setPath] = useState(session.source_folder)
  const [selected, setSelected] = useState<Map<string, BrowseItem>>(new Map())
  const [pulling, setPulling] = useState(false)
  const [pullMsg, setPullMsg] = useState('')
  const [busyDoc, setBusyDoc] = useState<string | null>(null)
  const [busySession, setBusySession] = useState(false)
  const [err, setErr] = useState('')
  const [showPull, setShowPull] = useState(docs.length === 0)
  // Quality check: one request per drawing, run in sequence with a live count, so a session
  // of thirty never sits behind a single long request and a failure on one is one line.
  const [qc, setQc] = useState<{ running: boolean; done: number; total: number; failed: string[] }>({ running: false, done: 0, total: 0, failed: [] })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [openOnly, setOpenOnly] = useState(true)

  async function checkQuality(targets: Doc[]) {
    if (!targets.length) return
    setQc({ running: true, done: 0, total: targets.length, failed: [] }); setErr('')
    const failed: string[] = []
    for (const d of targets) {
      try {
        const res = await fetch(`/api/prelim/documents/${d.id}/quality`, { method: 'POST' })
        if (!res.ok) { const j = await res.json().catch(() => ({})); failed.push(`${d.document_number ?? d.source_file_name}: ${j.error ?? res.status}`) }
      } catch (e: any) { failed.push(`${d.document_number ?? d.source_file_name}: ${e.message}`) }
      setQc(s => ({ ...s, done: s.done + 1, failed }))
    }
    setQc(s => ({ ...s, running: false }))
    router.refresh()
  }
  const withIssues = docs.filter(d => (d.quality_open ?? 0) > 0)
  const checked = docs.filter(d => d.quality_checked_at)
  const totalOpen = withIssues.reduce((a, d) => a + (d.quality_open ?? 0), 0)
  const toggleExpand = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  function exportCsv() {
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const rows = [['Document', 'Rev', 'Title', 'Source file', 'Severity', 'Page', 'Issue', 'How to fix', 'Checked']]
    for (const d of withIssues) for (const i of d.qualityIssues ?? []) rows.push([d.document_number ?? '', d.revision ?? '', d.title ?? '', d.source_file_url, i.severity, i.page == null ? '' : String(i.page), i.description, i.fix, d.quality_checked_at ?? ''])
    const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Quality issues - ${session.title}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const counts = { pending: 0, ready: 0, rework: 0, withdrawn: 0, handed: 0 }
  for (const d of docs) { counts[d.outcome]++; if (d.handed_over_batch_id) counts.handed++ }

  function toggle(i: BrowseItem) { setSelected(m => { const n = new Map(m); n.has(i.webUrl) ? n.delete(i.webUrl) : n.set(i.webUrl, i); return n }) }
  function selectAll(items: BrowseItem[]) { setSelected(m => { const n = new Map(m); for (const i of items) n.set(i.webUrl, i); return n }) }

  async function pull() {
    if (!selected.size) return
    setPulling(true); setErr(''); setPullMsg('')
    try {
      const res = await fetch(`/api/prelim/sessions/${session.id}/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [...selected.values()].map(i => ({ name: i.name, webUrl: i.webUrl })) }) })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Pull failed'); return }
      const r: any[] = d.results ?? []
      const ok = r.filter(x => x.ok && !x.skipped).length, skipped = r.filter(x => x.skipped).length, failed = r.filter(x => !x.ok)
      setPullMsg(`Pulled ${ok}${skipped ? `, ${skipped} already in the session` : ''}${failed.length ? `, ${failed.length} failed: ${failed.map(f => `${f.name} (${f.error})`).join('; ')}` : ''}.`)
      setSelected(new Map()); router.refresh()
    } catch (e: any) { setErr(e.message) } finally { setPulling(false) }
  }

  async function handover(doc: Doc) {
    if (!confirm(`Hand "${doc.document_number ?? doc.title ?? doc.source_file_name}" over to internal review? It will appear in Incoming Batches for reviewer assignment.`)) return
    setBusyDoc(doc.id); setErr('')
    try {
      const res = await fetch(`/api/prelim/documents/${doc.id}/handover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Hand-over failed'); return }
      router.refresh()
    } catch (e: any) { setErr(e.message) } finally { setBusyDoc(null) }
  }

  async function closeSession(reopen: boolean) {
    setBusySession(true); setErr('')
    try {
      const res = await fetch(`/api/prelim/sessions/${session.id}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reopen }) })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Could not close'); return }
      router.refresh()
    } catch (e: any) { setErr(e.message) } finally { setBusySession(false) }
  }

  return (
    <div className="space-y-5">
      <Link href="/prelim" className="btn-secondary text-xs py-1.5 px-3 w-fit"><ArrowLeft className="h-3.5 w-3.5" /> Sessions</Link>

      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{session.title}</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${open ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600'}`}>{session.status}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {[session.area, session.held_on ? new Date(session.held_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null, session.attendees ? `in the room: ${session.attendees}` : null].filter(Boolean).join(' · ')}
            </p>
            <p className="text-xs text-slate-400 mt-1 font-mono">{session.source_library}/{session.source_folder || '(library root)'}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {open && docs.length > 0 && (
              <button onClick={() => checkQuality(docs.filter(d => !d.handed_over_batch_id))} disabled={qc.running} className="btn-primary text-xs" title="Read every drawing's SOURCE file in COLAB and list the quality defects to fix before internal review">
                {qc.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} {qc.running ? `Checking ${qc.done} of ${qc.total}…` : 'Check quality'}
              </button>
            )}
            {canManage && open && <button onClick={() => setShowPull(v => !v)} className="btn-secondary text-xs"><Download className="h-3.5 w-3.5" /> {showPull ? 'Hide folder' : 'Pull drawings'}</button>}
            {canManage && <button onClick={() => closeSession(!open)} disabled={busySession} className="btn-secondary text-xs">{busySession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />} {open ? 'Close session' : 'Reopen'}</button>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
          <span><b className="text-slate-900">{docs.length}</b> drawings</span>
          <span>{counts.pending} pending</span><span className="text-emerald-700">{counts.ready} ready</span><span className="text-amber-700">{counts.rework} rework</span><span className="text-red-700">{counts.withdrawn} withdrawn</span><span className="text-teal-700">{counts.handed} handed over</span>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {qc.failed.length > 0 && !qc.running && <p className="mt-2 text-xs text-amber-700">Could not check {qc.failed.length}: {qc.failed.join(' · ')}</p>}
      </div>

      {/* ── Quality issues — the helper's job list ─────────────────────────────── */}
      {checked.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-200 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-3">
              <h2 className="font-semibold text-slate-900">Quality issues</h2>
              <span className="text-xs text-slate-500">{checked.length} of {docs.length} checked · <b className={totalOpen ? 'text-amber-700' : 'text-emerald-700'}>{totalOpen} open</b> on {withIssues.length} document{withIssues.length === 1 ? '' : 's'} · read from the source file in COLAB</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 text-slate-600"><input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} /> open issues only</label>
              {withIssues.length > 0 && <button onClick={exportCsv} className="btn-secondary text-xs py-1 px-2.5"><FileDown className="h-3 w-3" /> Export list</button>}
            </div>
          </div>
          {!withIssues.length && <p className="px-6 py-6 text-sm text-emerald-700">All checked drawings are clear.</p>}
          <ul className="divide-y divide-slate-100">
            {(openOnly ? withIssues : checked).map(d => {
              const isOpen = expanded.has(d.id); const n = d.quality_open ?? 0
              const majors = (d.qualityIssues ?? []).filter(i => i.severity === 'major').length
              return (
                <li key={d.id}>
                  <div className="flex items-center gap-3 px-6 py-2.5">
                    <button onClick={() => toggleExpand(d.id)} className="text-slate-400 hover:text-slate-700" aria-expanded={isOpen}>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/prelim/${session.id}/doc/${d.id}`} className="font-mono text-xs font-medium text-[#0B3563] underline decoration-teal-500 decoration-1 underline-offset-2 hover:text-teal-700">{d.document_number ?? d.source_file_name}</Link>
                        <a href={d.source_file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline" title="Open the source file in COLAB — this is the file to fix"><ExternalLink className="h-3 w-3" /> source in COLAB</a>
                        {n ? <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${majors ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{n} issue{n === 1 ? '' : 's'}{majors ? ` · ${majors} major` : ''}</span> : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">clear</span>}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{d.title} · checked {d.quality_checked_at ? new Date(d.quality_checked_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}{d.quality_source_modified_at ? ` · source saved ${new Date(d.quality_source_modified_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
                    </div>
                    <button onClick={() => checkQuality([d])} disabled={qc.running || !open} className="btn-secondary text-xs py-1 px-2.5">Re-check</button>
                  </div>
                  {isOpen && n > 0 && (
                    <ol className="mx-6 mb-3 ml-12 space-y-1.5 text-sm">
                      {(d.qualityIssues ?? []).map((i, k) => (
                        <li key={k} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs"><span className={`font-semibold uppercase ${i.severity === 'major' ? 'text-red-700' : 'text-amber-700'}`}>{i.severity}</span>{i.page != null && <span className="text-slate-500">page {i.page}</span>}<span className="text-slate-400">{i.code.replace(/_/g, ' ')}</span></div>
                          <div className="text-slate-800">{i.description}</div>
                          <div className="text-xs text-slate-600 mt-0.5"><b>Fix:</b> {i.fix}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {canManage && open && showPull && (
        <div className="card p-6 space-y-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="font-semibold text-slate-900">Pull drawings from the source folder</h2>
            <span className="text-xs text-slate-500">a working PDF copy of each is made for the room; the source file is not touched</span>
          </div>
          <FolderBrowser site={session.source_site_url} library={session.source_library} path={path} onPath={setPath} selectable selected={new Set(selected.keys())} onToggle={toggle} onSelectAll={selectAll} />
          <div className="flex items-center gap-3">
            <button onClick={pull} disabled={pulling || !selected.size} className="btn-primary">{pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Pull {selected.size || ''} selected</button>
            {pullMsg && <span className="text-xs text-slate-600">{pullMsg}</span>}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200"><h2 className="font-semibold text-slate-900">Drawings in this session</h2></div>
        {!docs.length && <p className="px-6 py-8 text-sm text-slate-400">Nothing pulled yet.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-2">Document</th><th className="px-4 py-2">Title</th><th className="px-4 py-2">Disc</th><th className="px-4 py-2">Quality</th><th className="px-4 py-2 text-right">Comments</th><th className="px-4 py-2">Room&rsquo;s call</th><th className="px-4 py-2">Formal review</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map(d => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Link href={`/prelim/${session.id}/doc/${d.id}`} className="font-mono text-xs font-medium text-[#0B3563] underline decoration-teal-500 decoration-1 underline-offset-2 hover:text-teal-700">{d.document_number ?? d.source_file_name}</Link>
                    {d.revision && <span className="ml-1 text-xs text-slate-400">rev {d.revision}</span>}
                    {!d.cddl_doc_id && <span className="ml-1 text-[10px] text-amber-700" title="No CDDL match — will be handed over as an unnumbered internal review">no CDDL match</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{d.title}</td>
                  <td className="px-4 py-2 text-slate-500">{d.discipline ?? ''}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {!d.quality_checked_at ? <span className="text-xs text-slate-300">not checked</span>
                      : (d.quality_open ?? 0) > 0 ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">{d.quality_open} open</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">clear</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.commentCount}{d.unsavedMarks && <span className="ml-1 text-[10px] text-amber-700" title="Marks drawn but not yet saved to SharePoint">unsaved marks</span>}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${OUTCOME_PILL[d.outcome]}`}>{d.outcome}</span>
                    {d.outcome === 'rework' && d.rework_to_email && <span className="ml-1 text-xs text-slate-500">→ {d.rework_to_email}</span>}
                    {d.outcome_note && <div className="text-xs text-slate-500 mt-0.5 max-w-xs truncate" title={d.outcome_note}>{d.outcome_note}</div>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {d.handed_over_batch_id
                      ? <Link href={`/batches/${d.handed_over_batch_id}`} className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline"><ExternalLink className="h-3 w-3" /> in internal review</Link>
                      : d.outcome === 'ready' && canManage && open
                        ? <button onClick={() => handover(d)} disabled={busyDoc === d.id || d.unsavedMarks} title={d.unsavedMarks ? 'Save the marks to SharePoint first' : 'Create the formal internal review batch'} className="btn-primary text-xs py-1 px-2.5">{busyDoc === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Hand over</button>
                        : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right"><Link href={`/prelim/${session.id}/doc/${d.id}`} className="btn-secondary text-xs py-1 px-2.5">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
