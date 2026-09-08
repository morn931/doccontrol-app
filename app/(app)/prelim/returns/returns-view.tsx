'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { STATUS_LABEL, STATUS_CLS, fromLabel, type PrelimStatus } from '@/lib/prelim/status'

type Row = {
  id: string; session_id: string; session: string; document_number: string | null; revision: string | null; title: string | null; status: PrelimStatus
  returned_at: string | null; returned_by_email: string | null; returned_from: string | null; returned_file_name: string | null; returned_file_url: string | null
  routing: string | null; routing_at: string | null; routing_by_email: string | null; routing_to_name: string | null; routing_to_email: string | null; timesReturned: number; tender_stamped_file_url: string | null; tender_stamp_error: string | null
}
type Candidate = { id: string; document_number: string | null; revision: string | null; title: string | null; session: string; routing: string | null }
type Item = { file: File; state: 'queued' | 'matching' | 'pick' | 'uploading' | 'done' | 'error'; pct: number; msg: string; doc?: Candidate; reason?: string; candidates?: Candidate[]; all?: Candidate[]; chosen?: string }

// Graph upload-session chunk size — a multiple of 320 KiB, as Graph requires.
const CHUNK = 5 * 320 * 1024
const when = (s: string | null) => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

export default function ReturnsView({ docs }: { docs: Row[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [over, setOver] = useState(false)
  const [readyBusy, setReadyBusy] = useState<string | null>(null)
  const [readyMsg, setReadyMsg] = useState<Record<string, string>>({})
  // The last check after a correction comes back: Ready for tender from this list stamps the
  // RETURNED file and files it as the tender copy, replacing whatever was in COLAB's
  // Issued for Tender folder for this drawing (same name, replace on conflict).
  async function readyForTender(d: Row) {
    if (!confirm(`Mark ${d.document_number ?? d.title} ready for tender?\n\nThe returned file is stamped "ISSUED FOR TENDER ONLY" on every page and filed in COLAB under Issued for Tender, replacing any earlier stamped copy of this drawing.`)) return
    setReadyBusy(d.id); setReadyMsg(m => ({ ...m, [d.id]: '' }))
    try {
      const res = await fetch(`/api/prelim/documents/${d.id}/routing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ready_for_tender' }) })
      const j = await res.json()
      if (!res.ok) { setReadyMsg(m => ({ ...m, [d.id]: j.error ?? 'Could not mark ready.' })); router.refresh(); return }
      setReadyMsg(m => ({ ...m, [d.id]: `Stamped copy filed${j.tenderCopy?.pages ? ` (${j.tenderCopy.pages} page${j.tenderCopy.pages === 1 ? '' : 's'})` : ''}.` }))
      router.refresh()
    } catch (e: any) { setReadyMsg(m => ({ ...m, [d.id]: e.message })) } finally { setReadyBusy(null) }
  }
  const upd = (file: File, patch: Partial<Item>) => setItems(list => list.map(i => i.file === file ? { ...i, ...patch } : i))

  async function process(file: File, docId?: string) {
    upd(file, { state: 'matching', msg: 'Matching to a drawing…' })
    try {
      const sr = await fetch('/api/prelim/returns/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, docId }) })
      const sd = await sr.json()
      if (sr.status === 409 && sd.needPick) { upd(file, { state: 'pick', reason: sd.reason, candidates: sd.candidates ?? [], all: sd.all ?? [], chosen: sd.candidates?.[0]?.id ?? '', msg: '' }); return }
      if (!sr.ok) { upd(file, { state: 'error', msg: sd.error ?? 'Could not start the upload.' }); return }
      upd(file, { state: 'uploading', doc: sd.doc, pct: 0, msg: 'Uploading…' })
      const bytes = new Uint8Array(await file.arrayBuffer())
      let uploaded: { webUrl?: string; name?: string } | null = null
      for (let pos = 0; pos < bytes.length; pos += CHUNK) {
        const part = bytes.slice(pos, pos + CHUNK)
        const r = await fetch(sd.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${pos}-${pos + part.length - 1}/${bytes.length}` }, body: part as unknown as BodyInit })
        if (!r.ok && r.status !== 202) throw new Error(`Upload failed (${r.status})`)
        if (r.status === 200 || r.status === 201) uploaded = await r.json()
        upd(file, { pct: Math.round(((pos + part.length) / bytes.length) * 100) })
      }
      if (!uploaded?.webUrl) throw new Error('Upload did not complete — please try again.')
      upd(file, { msg: 'Recording the return…' })
      const cr = await fetch('/api/prelim/returns/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId: sd.doc.id, webUrl: uploaded.webUrl, fileName: uploaded.name ?? file.name }) })
      const cd = await cr.json()
      if (!cr.ok) { upd(file, { state: 'error', msg: cd.error ?? 'Could not record the return.' }); return }
      upd(file, { state: 'done', msg: `Returned${sd.wasSent ? '' : ' (it had not been sent out — recorded anyway)'}${cd.notified ? ` · ${cd.notified} told` : ''}.` })
      router.refresh()
    } catch (e: any) { upd(file, { state: 'error', msg: e?.message ?? String(e) }) }
  }

  function take(files: FileList | File[]) {
    const list = [...files].filter(f => f.size > 0)
    if (!list.length) return
    setItems(prev => [...list.map(file => ({ file, state: 'queued' as const, pct: 0, msg: '' })), ...prev])
    // one at a time — SharePoint upload sessions and the room's own reads share the tenant
    ;(async () => { for (const f of list) await process(f) })()
  }

  return (
    <div className="space-y-5">
      <Link href="/prelim" className="btn-secondary text-xs py-1.5 px-3 w-fit"><ArrowLeft className="h-3.5 w-3.5" /> Prelim Review</Link>
      <div className="card p-6">
        <h1 className="text-xl font-bold text-slate-900">Return from Drawing Office / Document Control / Lead Engineer</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          When the drawing office, Document Control or the lead engineer has finished the corrections, drop the corrected <b>PDF</b> here. It is matched to its drawing by
          the document number in the filename, <b>replaces</b> that drawing&rsquo;s working copy in the session folder (the marked-up version lives on in the email that went out), and the
          three before-tender buttons unlock so the reviewer can check it and call it <b>Ready for tender</b> — or send it out again.
        </p>
        <div
          onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
          className={`mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center cursor-pointer transition ${over ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50 hover:border-slate-400'}`}>
          <Upload className="h-7 w-7 text-teal-600" />
          <p className="text-sm font-semibold text-slate-800">Drop the corrected PDFs here, or click to choose</p>
          <p className="text-xs text-slate-500">Keep the document number in the filename (e.g. 6105AK124-6200-ESCH-0001_A.pdf) and it files itself. Otherwise you will be asked which drawing it is.</p>
          <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={e => { if (e.target.files) take(e.target.files); e.target.value = '' }} />
        </div>

        {items.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {items.map(it => (
              <li key={it.file.name + it.file.size} className="px-4 py-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  {it.state === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : it.state === 'error' || it.state === 'pick' ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                  <span className="font-medium text-slate-800">{it.file.name}</span>
                  {it.doc && <span className="text-xs text-slate-500">→ {it.doc.document_number ?? it.doc.title} · {it.doc.session.replace(/ — .*$/, '')}</span>}
                  {it.state === 'uploading' && <span className="text-xs text-slate-500 tabular-nums">{it.pct}%</span>}
                  <span className={`text-xs ${it.state === 'error' ? 'text-red-600' : it.state === 'done' ? 'text-emerald-700' : 'text-slate-500'}`}>{it.msg}</span>
                </div>
                {it.state === 'pick' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-amber-800">{it.reason}</span>
                    <select className="input w-auto text-xs py-1" value={it.chosen ?? ''} onChange={e => upd(it.file, { chosen: e.target.value })}>
                      <option value="">— choose the drawing —</option>
                      {(it.candidates?.length ?? 0) > 0 && <optgroup label="Likely">{it.candidates!.map(c => <option key={c.id} value={c.id}>{c.document_number ?? c.title} · {c.session.replace(/ — .*$/, '')}</option>)}</optgroup>}
                      <optgroup label="All drawings in open sessions">{(it.all ?? []).filter(c => !it.candidates?.some(x => x.id === c.id)).map(c => <option key={c.id} value={c.id}>{c.document_number ?? c.title} · {c.session.replace(/ — .*$/, '')}</option>)}</optgroup>
                    </select>
                    <button className="btn-primary text-xs py-1 px-2.5" disabled={!it.chosen} onClick={() => process(it.file, it.chosen)}>Use this drawing</button>
                    <button className="btn-secondary text-xs py-1 px-2.5" onClick={() => setItems(l => l.filter(x => x.file !== it.file))}>Skip</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200 flex items-baseline justify-between">
          <h2 className="font-semibold text-slate-900">Returned drawings</h2>
          <span className="text-xs text-slate-500">{docs.length} returned · {docs.filter(d => d.status === 'ready_for_tender').length} now ready for tender</span>
        </div>
        {!docs.length && <p className="px-6 py-8 text-sm text-slate-400">Nothing has come back yet.</p>}
        {docs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-2">Document</th><th className="px-4 py-2">Title</th><th className="px-4 py-2">Session</th><th className="px-4 py-2">Returned</th><th className="px-4 py-2">Status now</th><th className="px-4 py-2 text-right">Last check</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link href={`/prelim/${d.session_id}/doc/${d.id}`} className="font-mono text-xs font-medium text-[#0B3563] underline decoration-teal-500 decoration-1 underline-offset-2 hover:text-teal-700">{d.document_number ?? d.title}</Link>
                      {d.revision && <span className="ml-1 text-xs text-slate-400">rev {d.revision}</span>}
                      {d.timesReturned > 1 && <span className="ml-1 text-[10px] text-slate-400">×{d.timesReturned}</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-700 max-w-md truncate" title={d.title ?? ''}>{d.title}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{d.session.replace(/ — .*$/, '')}</td>
                    <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                      from {fromLabel(d.returned_from)} · {when(d.returned_at)}
                      {d.returned_file_url && <> · <a href={d.returned_file_url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">{d.returned_file_name}</a></>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CLS[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                      {d.routing && <div className="text-xs text-slate-500 mt-0.5">{d.routing === 'ready_for_tender' ? `${d.routing_by_email} · ${when(d.routing_at)}` : `→ ${d.routing_to_name ?? d.routing_to_email} · ${when(d.routing_at)}`}</div>}
                      {d.routing === 'ready_for_tender' && (d.tender_stamped_file_url
                        ? <div className="text-xs mt-0.5"><a href={d.tender_stamped_file_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">stamped copy ↗</a></div>
                        : <div className="text-xs text-red-600 mt-0.5" title={d.tender_stamp_error ?? undefined}>no stamped copy</div>)}
                      {readyMsg[d.id] && <div className={`text-xs mt-0.5 ${/could not|fail|error/i.test(readyMsg[d.id]) ? 'text-red-600' : 'text-emerald-700'}`}>{readyMsg[d.id]}</div>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {!d.routing && (
                        <button onClick={() => readyForTender(d)} disabled={readyBusy !== null} title="Stamp the returned file ISSUED FOR TENDER ONLY and file it in COLAB, replacing any earlier stamped copy" className="btn-primary text-xs py-1 px-2.5 mr-2">
                          {readyBusy === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Ready for tender
                        </button>
                      )}
                      <Link href={`/prelim/${d.session_id}/doc/${d.id}`} className="btn-secondary text-xs py-1 px-2.5">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
