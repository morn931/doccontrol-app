'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { getRfiThread, type RfiMail } from './actions'
import type { Rfi } from './rfi-board'

// ── RFI Report popup — same report engine as CoreCost's PDN Report
// (costflow-app src/app/pdn/aconex-popup.tsx), adapted for RFI threads:
// whose-court banner + AI summary + RFI form key facts + correspondence
// timeline + attachments + Print/PDF. Attachments stream via the CoreDocs
// session proxy /api/aconex/mail-attachment (→ CoreCost → Aconex).

const fmtSize = (s?: string) => {
  const n = Number(s)
  if (!n) return ''
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const daysSince = (d?: string | null) =>
  d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null

const aconexStatusClass = (s?: string | null) => {
  switch ((s ?? '').toLowerCase()) {
    case 'outstanding': return 'bg-amber-100 text-amber-800 border-amber-300'
    case 'overdue': return 'bg-red-100 text-red-800 border-red-300'
    case 'partial': return 'bg-sky-100 text-sky-800 border-sky-300'
    case 'responded': return 'bg-emerald-100 text-emerald-800 border-emerald-300'
    case 'closed-out': return 'bg-neutral-100 text-neutral-600 border-neutral-300'
    default: return 'bg-neutral-50 text-neutral-500 border-neutral-200'
  }
}

const isPpe = (org?: string | null) =>
  (org ?? '').toUpperCase().includes('PPE') || (org ?? '').toUpperCase().includes('POWER PLANT')

/** Who currently needs to act, based on the latest mail + unanswered recipients. */
function currentBall(mails: RfiMail[]) {
  if (mails.length === 0) return null
  const last = mails[mails.length - 1]
  const waiting = (last.recipients ?? []).filter(
    (r) => r.type === 'TO' && !['responded', 'closed-out', 'n/a'].includes((r.status ?? '').toLowerCase())
  )
  const days = daysSince(last.sent_date)
  if (waiting.length > 0) {
    const orgs = [...new Set(waiting.map((r) => r.org))]
    return { who: orgs.join(', '), people: waiting.map((r) => r.name), days, since: last.sent_date, ppeSide: orgs.some(isPpe) }
  }
  return { who: last.from_org ?? '—', people: last.from_user ? [last.from_user] : [], days, since: last.sent_date, ppeSide: isPpe(last.from_org) }
}

// Short RFI-form facts (in display order); the long text fields render as paragraphs.
const KEY_FIELDS = [
  'Contractor Package No.', 'RFI Cause', 'Cost Impact', 'Schedule Impact', 'To Redline',
  'Impacted Specs/ Documents/ Drawings',
]
const LONG_FIELDS: [string, string][] = [
  ['RFI Description', 'Request'],
  ['Proposed Solution', 'Proposed solution'],
  ['Cost Impact Details or Solution', 'Cost impact details'],
  ['Schedule Impact Details or Solution', 'Schedule impact details'],
]

/** Deduped attachments across the whole thread, each with its source mail. */
function uniqueAttachments(mails: RfiMail[]) {
  const seen = new Map<string, { file: string; size?: string; mailId: number; mailNo: string; date: string | null; fromOrg: string; attachmentId?: string | null }>()
  for (const m of mails) {
    for (const a of m.attachments ?? []) {
      const key = `${a.FileName ?? ''}|${a.FileSize ?? ''}`
      if (!seen.has(key)) {
        seen.set(key, {
          file: a.FileName ?? a.kind,
          size: a.FileSize,
          mailId: m.mail_id,
          mailNo: m.mail_no ?? '',
          date: m.sent_date,
          fromOrg: m.from_org ?? '',
          attachmentId: a.attachment_id,
        })
      }
    }
  }
  return [...seen.values()]
}

const attachmentHref = (a: { mailId: number; attachmentId?: string | null; file: string }) =>
  `/api/aconex/mail-attachment?mailId=${a.mailId}&attachmentId=${a.attachmentId ?? ''}&filename=${encodeURIComponent(a.file)}`

// Print just this report card (WYSIWYG) — see the PDN popup for the rationale.
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body > *:not(.rfi-overlay) { display: none !important; }
  .rfi-overlay { position: static !important; background: none !important; padding: 0 !important; display: block !important; }
  #rfi-report, #rfi-report * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  #rfi-report {
    position: static !important; width: 100% !important;
    max-width: 100% !important; max-height: none !important; overflow: visible !important;
    box-shadow: none !important; border-radius: 0 !important;
  }
  #rfi-report .sticky { position: static !important; }
  .no-print { display: none !important; }
}
`

function ReportBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="relative overflow-hidden border-b border-slate-200 bg-white bg-contain bg-right bg-no-repeat px-6 py-3"
      style={{ backgroundImage: "url('/coreflow/header/backgrounds/hero-industrial-desktop-1920w.png')" }}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white via-white/85 to-transparent" />
      <div className="relative flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/coreflow/logo/coreflow-logo-header-crop.png" alt="Coreflow" className="h-9 w-auto shrink-0 object-contain" />
        <span className="text-lg font-thin text-slate-300">|</span>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold uppercase tracking-wide text-[#0B3563]">{title}</span>
          <span className="text-xs text-slate-500">{subtitle}</span>
        </div>
      </div>
    </div>
  )
}

export default function RfiPopup({ rfi, onClose }: { rfi: Rfi; onClose: () => void }) {
  const [mails, setMails] = useState<RfiMail[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openMails, setOpenMails] = useState<Set<number>>(new Set())
  const toggleMail = (i: number) =>
    setOpenMails((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n })
  const [attOpen, setAttOpen] = useState(false)
  const [generatedAt] = useState(() => new Date())
  const generatedLabel = generatedAt.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  useEffect(() => {
    getRfiThread(rfi.id).then((r) => (r.ok ? setMails(r.mails) : setError(r.error)))
  }, [rfi.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ball = useMemo(() => (mails ? currentBall(mails) : null), [mails])
  const rootForm = useMemo(() => {
    if (!mails) return null
    const withForm = mails.find((m) => m.form_fields && Object.keys(m.form_fields).length > 0)
    return withForm?.form_fields ?? null
  }, [mails])
  const totalAttachments = useMemo(
    () => (mails ?? []).reduce((s, m) => s + (m.attachments?.length ?? 0), 0),
    [mails]
  )
  const uniqueAtts = useMemo(() => (mails ? uniqueAttachments(mails) : []), [mails])

  return createPortal(
    <div className="rfi-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <style>{PRINT_CSS}</style>
      <div
        id="rfi-report"
        className="max-h-full w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ReportBanner title="RFI Report" subtitle={`CoreDocs · Reko Diq (RDMC) · Generated ${generatedLabel}`} />

        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">{rfi.mail_no}</h2>
                {rfi.package_code && (
                  <span className="inline-block rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-xs">{rfi.package_code}</span>
                )}
                <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${aconexStatusClass(rfi.aconex_status)}`}>
                  Aconex: {rfi.aconex_status ?? '—'}
                </span>
                {rfi.corr_type && rfi.corr_type !== 'Request For Information' && (
                  <span className="inline-block rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">{rfi.corr_type}</span>
                )}
              </div>
              <div className="mt-1 text-sm text-neutral-500">{rfi.title}</div>
            </div>
            <div className="no-print flex shrink-0 items-center gap-2">
              {uniqueAtts.length > 0 && (
                <div className="relative">
                  <button onClick={() => setAttOpen((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 text-sm font-medium ${attOpen ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'}`}>
                    📎 Attachments ({uniqueAtts.length}) {attOpen ? '▲' : '▼'}
                  </button>
                  {attOpen && (
                    <div className="absolute right-0 z-30 mt-1 max-h-96 w-[26rem] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-2 shadow-xl">
                      <button onClick={() => setAttOpen(false)} title="Close"
                        className="absolute right-1.5 top-1.5 rounded px-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">✕</button>
                      <div className="mb-1 px-1 pr-6 text-[10px] uppercase tracking-wide text-neutral-400">
                        All unique files on this RFI — click to open
                      </div>
                      <ul className="divide-y divide-neutral-100">
                        {uniqueAtts.map((a, i) => (
                          <li key={i} className="px-1 py-1.5">
                            <a href={attachmentHref(a)} target="_blank" rel="noreferrer"
                              className="block text-xs font-medium text-blue-800 underline underline-offset-2 hover:text-blue-600">
                              {a.file}
                            </a>
                            <div className="text-[10px] text-neutral-400">
                              {fmtSize(a.size)} · attached to {a.mailNo} ({a.fromOrg}, {fmtDate(a.date)}) · live from Aconex
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => window.print()}
                title="Print this report — open the mails you want, correct any text inline, then Save as PDF from the browser dialog"
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
                🖨 Print / PDF
              </button>
              <button onClick={onClose} className="rounded-md border border-neutral-200 px-2.5 py-1 text-sm text-neutral-500 hover:bg-neutral-100">✕ Close</button>
            </div>
          </div>

          {/* Whose court — editable single text node (correct it before printing) */}
          {ball && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${ball.ppeSide ? 'border-amber-300 bg-amber-50' : 'border-sky-200 bg-sky-50'}`}>
              <b className="mr-1">Action:</b>
              <span contentEditable suppressContentEditableWarning
                className="rounded outline-none focus:bg-white/70 focus:ring-1 focus:ring-amber-300 print:focus:ring-0">
                {(ball.ppeSide ? '⚠ with PPE — ' : '⏳ waiting on ') + ball.who
                  + (ball.people.length > 0 ? ` (${ball.people.slice(0, 4).join(', ')}${ball.people.length > 4 ? '…' : ''})` : '')
                  + (ball.days != null ? ` — ${ball.days} day${ball.days === 1 ? '' : 's'} since the last mail (${fmtDate(ball.since)})` : '')}
              </span>
            </div>
          )}

          {/* AI summary — editable single text node */}
          {rfi.summary && (
            <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
              <b className="mr-1">Summary:</b>
              <span contentEditable suppressContentEditableWarning
                className="rounded outline-none focus:bg-white/70 focus:ring-1 focus:ring-violet-300 print:focus:ring-0">
                {rfi.summary}
              </span>
            </div>
          )}

          <p className="no-print mt-2 text-[11px] text-neutral-400">
            ✎ Open the mails you want, click the <b>Action</b> or <b>Summary</b> text to correct it, then <b>🖨 Print / PDF</b>. Inline edits print but aren&apos;t saved.
          </p>
        </div>

        <div className="px-6 py-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!mails && !error && <p className="text-sm text-neutral-400">Loading thread…</p>}

          {mails && (
            <>
              {/* Key facts from the structured RFI form */}
              {rootForm && (
                <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">RFI form (from Aconex)</div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {KEY_FIELDS.filter((k) => rootForm[k]).map((k) => (
                      <div key={k} className="flex gap-2">
                        <dt className="w-44 shrink-0 text-xs text-neutral-500">{k}</dt>
                        <dd className="text-xs font-medium">{rootForm[k]}</dd>
                      </div>
                    ))}
                  </dl>
                  {LONG_FIELDS.filter(([k]) => rootForm[k]).map(([k, label]) => (
                    <p key={k} className="mt-2 border-t border-neutral-200 pt-2 text-xs text-neutral-600">
                      <b>{label}:</b> {rootForm[k]}
                    </p>
                  ))}
                </div>
              )}

              {/* Thread timeline */}
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Correspondence — {mails.length} mail{mails.length === 1 ? '' : 's'}, {totalAttachments} attachment{totalAttachments === 1 ? '' : 's'}
                </div>
                {mails.length > 1 && (
                  <button
                    onClick={() => setOpenMails(openMails.size === mails.length ? new Set() : new Set(mails.map((_, i) => i)))}
                    className="no-print rounded border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
                    {openMails.size === mails.length ? 'Collapse all' : 'Expand all'}
                  </button>
                )}
              </div>
              <ol className="space-y-2">
                {mails.map((m, i) => {
                  const open = openMails.has(i)
                  const fromPpe = isPpe(m.from_org)
                  return (
                    <li key={m.id} className={`rounded-lg border ${fromPpe ? 'border-teal-200' : 'border-neutral-200'}`}>
                      <button
                        onClick={() => toggleMail(i)}
                        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-neutral-50"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold">{fmtDate(m.sent_date)}</span>
                            <span className={`rounded px-1 text-[10px] font-medium ${fromPpe ? 'bg-teal-100 text-teal-800' : 'bg-neutral-100 text-neutral-600'}`}>
                              {m.from_org || '?'}
                            </span>
                            <span className="text-neutral-400">{m.from_user}</span>
                            <span className="text-neutral-300">·</span>
                            <span className="text-neutral-500">{m.mail_no}</span>
                            {m.status && (
                              <span className={`rounded border px-1 text-[10px] ${aconexStatusClass(m.status)}`}>{m.status}</span>
                            )}
                            {(m.attachments?.length ?? 0) > 0 && (
                              <span className="text-neutral-500">📎 {m.attachments!.length}</span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-sm">{m.subject}</div>
                        </div>
                        <span className="no-print mt-1 text-xs text-neutral-400">{open ? '▲' : '▼'}</span>
                      </button>

                      {open && (
                        <div className="border-t border-neutral-100 px-3 py-2">
                          {(m.recipients?.length ?? 0) > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1 text-[10px]">
                              {m.recipients!.map((r, j) => (
                                <span key={j} className={`rounded border px-1 py-0.5 ${aconexStatusClass(r.status)}`}
                                  title={`${r.type}: ${r.status}`}>
                                  {r.type === 'CC' ? 'cc ' : ''}{r.name} · {r.status || '—'}
                                </span>
                              ))}
                            </div>
                          )}
                          {(m.attachments?.length ?? 0) > 0 && (
                            <ul className="mb-2 space-y-0.5 text-xs">
                              {m.attachments!.map((a, j) => (
                                <li key={j} className="flex items-center gap-2">
                                  <span>📎</span>
                                  <a href={attachmentHref({ mailId: m.mail_id, attachmentId: a.attachment_id, file: a.FileName ?? a.kind })}
                                    target="_blank" rel="noreferrer"
                                    className="font-medium text-blue-800 underline underline-offset-2 hover:text-blue-600">
                                    {a.FileName ?? a.kind}
                                  </a>
                                  <span className="text-neutral-400">{fmtSize(a.FileSize)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {m.body_html ? (
                            <div
                              className="max-w-none overflow-x-auto rounded border border-neutral-100 bg-white p-3 text-xs leading-relaxed [&_table]:text-[10px] [&_td]:border [&_td]:border-neutral-200 [&_td]:px-1"
                              dangerouslySetInnerHTML={{ __html: m.body_html }}
                            />
                          ) : (
                            <p className="text-xs text-neutral-400">No body text.</p>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>

              <p className="no-print mt-4 text-[11px] text-neutral-400">
                Cached from Aconex — refreshed by the daily 06:00 scan (<code>scripts/aconex_rfi_sync.py</code>). Attachment links stream live from Aconex.
              </p>
            </>
          )}
        </div>

        {/* Branded report footer band */}
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-neutral-200 bg-neutral-50 px-6 py-2 text-[10px] text-neutral-400">
          <span>CoreDocs RFI Report · {rfi.mail_no} · Summary is AI-generated{rfi.raised_date ? ` · raised ${fmtDate(rfi.raised_date)}` : ''}</span>
          <span>Generated {generatedLabel} · docs.coreflow.build/rfi</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
