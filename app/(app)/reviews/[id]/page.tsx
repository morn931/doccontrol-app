'use client'
import { useState, useEffect, use } from 'react'
import {
  ArrowLeft, ExternalLink, Send, AlertTriangle, Save, CheckCircle,
  ChevronDown, ChevronUp, Users, History, FileText, Plus, X, RefreshCw
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

const OUTCOME_CODES = [
  { code: 'A1', label: 'Data Complete — No Comments — Do Not Resubmit',          color: 'border-emerald-500  bg-green-50  text-emerald-800'  },
  { code: 'D1', label: 'Received for Info Only — No Comment — Do Not Resubmit',  color: 'border-teal-500   bg-blue-50   text-teal-800'   },
  { code: 'B1', label: 'Data Complete — With Comments — Proceed — Resubmit',     color: 'border-amber-500 bg-amber-50 text-amber-800' },
  { code: 'B2', label: 'Data Incomplete — With Comments — Proceed — Resubmit',   color: 'border-amber-500 bg-amber-50 text-amber-800' },
  { code: 'C1', label: 'Data Incomplete — With Comments — Hold Work — Resubmit', color: 'border-red-500    bg-red-50    text-red-800'    },
  { code: 'Q1', label: 'Quality is below Standard — Revise and Resubmit',         color: 'border-red-700    bg-red-100   text-red-900'    },
  { code: 'V1', label: 'Cancelled',                                               color: 'border-slate-400   bg-slate-50   text-slate-600'  },
  { code: 'S1', label: 'Superseded',                                              color: 'border-slate-400   bg-slate-50   text-slate-600'  },
]

// Internal-review outcomes (a drawing from a PPE internal reviewer, not a client/vendor):
// only A1 / B1 / Q1, and the A1/B1 labels drop the client resubmit-disposition clause.
const INTERNAL_OUTCOME_CODES = [
  { code: 'A1', label: 'Data Complete — No Comments',                       color: 'border-emerald-500 bg-green-50 text-emerald-800' },
  { code: 'B1', label: 'Data Complete — With Comments',                     color: 'border-amber-500   bg-amber-50 text-amber-800'   },
  { code: 'Q1', label: 'Quality is below Standard — Revise and Resubmit',   color: 'border-red-700     bg-red-100  text-red-900'     },
]

// Site-redline outcomes (ruled 2026-07-30): the reviewing engineer simply
// accepts (owns the As-Built from here) or rejects (back to site to re-mark).
const REDLINE_OUTCOME_CODES = [
  { code: 'A1', label: 'Accept — changes are valid; I take it for drafting and will upload the As-Built',
    color: 'border-emerald-500 bg-green-50 text-emerald-800' },
  { code: 'Q1', label: 'Reject — back to site to re-mark and resubmit (comment required)',
    color: 'border-red-700 bg-red-100 text-red-900' },
]

const OUTCOME_COLORS: Record<string, string> = {
  A1:'bg-green-100 text-emerald-700', D1:'bg-blue-100 text-teal-700',
  B1:'bg-amber-100 text-amber-700', B2:'bg-amber-100 text-amber-700',
  C1:'bg-red-100 text-red-700', Q1:'bg-red-200 text-red-800',
  V1:'bg-slate-100 text-slate-500', S1:'bg-slate-100 text-slate-400',
}

function reviewerName(email: string) {
  return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function ReviewWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [ctx, setCtx]           = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [outcome, setOutcome]   = useState('')
  const [comment, setComment]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [error, setError]       = useState('')
  const [showNMR, setShowNMR]   = useState(false)
  const [nmrReason, setNmrReason] = useState('')
  const [showChain, setShowChain] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [showAddReviewer, setShowAddReviewer] = useState(false)
  const [newReviewerEmail, setNewReviewerEmail] = useState('')
  const [newReviewerName, setNewReviewerName] = useState('')
  const [reviewerSearch, setReviewerSearch] = useState('')
  const [projectUsers, setProjectUsers] = useState<{ id: string; email: string; full_name: string | null }[]>([])
  const [newReviewerReason, setNewReviewerReason] = useState('')
  const [addingReviewer, setAddingReviewer] = useState(false)
  const [showOffice, setShowOffice] = useState(false)
  const [officeUrl, setOfficeUrl] = useState('')
  const [officeLoading, setOfficeLoading] = useState(false)
  const [officeError, setOfficeError] = useState('')
  const [officeMode, setOfficeMode] = useState<'edit' | 'read'>('read')
  const [officeCanConnect, setOfficeCanConnect] = useState(false)
  const [officeEditHref, setOfficeEditHref] = useState('')
  const [officeDvId, setOfficeDvId] = useState('')

  // Pre-init MSAL so the edit token can be acquired silently for a connected user.
  useEffect(() => { import('@/lib/msal').then(m => m.initMsal()).catch(() => {}) }, [])

  async function openOfficeViewer(dvId: string) {
    setShowOffice(true); setOfficeError(''); setOfficeUrl(''); setOfficeCanConnect(false); setOfficeDvId(dvId)
    setOfficeEditHref(''); setOfficeLoading(true)
    try {
      // The in-window Office surface is READ-ONLY: Microsoft only lets its embeddable
      // preview (embed.aspx) be framed on a third-party domain — the full editor
      // (Doc.aspx?action=edit) sets X-Frame-Options and can't be iframed here. So we show
      // the read preview in-window and offer a one-click "Edit in Word/Excel" that opens
      // the REAL editor in a new tab (same SharePoint file → edits save straight back).
      try {
        const di = await (await fetch(`/api/documents/${dvId}/drive-item`)).json()
        if (di?.webUrl) setOfficeEditHref(String(di.webUrl) + (String(di.webUrl).includes('?') ? '&' : '?') + 'action=edit')
      } catch { /* edit link is best-effort; the read view still works for everyone */ }
      const res = await fetch(`/api/documents/${dvId}/office-embed`)
      const data = await res.json()
      if (!res.ok) { setOfficeError(data.error ?? 'Could not open the viewer'); return }
      setOfficeUrl(data.url); setOfficeMode('read')
    } catch (e: any) {
      setOfficeError(e.message ?? 'Unexpected error')
    } finally {
      setOfficeLoading(false)
    }
  }

  async function connectAndEdit() {
    try {
      const msal = await import('@/lib/msal')
      // silent first; if the user has no Microsoft session this throws and we redirect.
      await msal.acquireSilent(msal.EDIT_SCOPES).catch(() => msal.signInRedirect(msal.EDIT_SCOPES))
      if (officeDvId) await openOfficeViewer(officeDvId)   // retry now-connected
    } catch { /* redirect flow will bring them back */ }
  }

  useEffect(() => { loadContext() }, [id])

  // Load the project-user directory the first time the add-reviewer panel opens, so
  // reviewers are picked from a list (no hand-typed emails → no typos / mis-routing).
  useEffect(() => {
    if (showAddReviewer && projectUsers.length === 0) {
      fetch('/api/reviewer-suggestions')
        .then(r => (r.ok ? r.json() : { users: [] }))
        .then(d => setProjectUsers(d.users ?? []))
        .catch(() => {})
    }
  }, [showAddReviewer, projectUsers.length])

  async function loadContext() {
    setLoading(true)
    const res = await fetch(`/api/reviews/${id}/context`)
    if (res.ok) {
      const data = await res.json()
      setCtx(data)
      if (data.task?.comment) setComment(data.task.comment)
      if (data.task?.review_outcome_code) setOutcome(data.task.review_outcome_code)
      if (['sent','pending'].includes(data.task?.status)) {
        await fetch(`/api/reviews/${id}/open`, { method: 'PATCH' })
      }
    }
    setLoading(false)
  }

  async function handleSubmit() {
    if (!outcome) { setError('Please select an outcome code'); return }
    // Rejecting a redline sends the submitter back to re-mark — they need to know why.
    if (ctx?.task?.document_versions?.batches?.source === 'redline' && outcome === 'Q1' && !comment.trim()) {
      setError('Please add a comment explaining why the redline is rejected — the site submitter is told to re-mark.'); return
    }
    setError(''); setSubmitting(true)
    const res = await fetch(`/api/reviews/${id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcomeCode: outcome, comment }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Submission failed'); setSubmitting(false) }
    else setSubmitted(true)
    setSubmitting(false)
  }

  async function handleNMR() {
    setError(''); setSubmitting(true)
    const res = await fetch(`/api/reviews/${id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ needMoreReview: true, comment: nmrReason || comment }),
    })
    if (res.ok) setSubmitted(true)
    else { const d = await res.json(); setError(d.error ?? 'Failed'); setSubmitting(false) }
  }

  async function handleAddReviewer() {
    if (!newReviewerEmail.trim()) return
    setAddingReviewer(true)
    const res = await fetch(`/api/batches/${ctx.task.batch_id}/add-reviewer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewerEmail: newReviewerEmail.trim(),
        reviewerName: newReviewerName || reviewerName(newReviewerEmail.trim()),
        insertAfterSequence: ctx.task.sequence_number,
        reason: newReviewerReason,
      }),
    })
    if (res.ok) {
      setShowAddReviewer(false); setNewReviewerEmail(''); setNewReviewerName(''); setReviewerSearch(''); setNewReviewerReason('')
      loadContext()
    }
    setAddingReviewer(false)
  }

  async function saveDraft() {
    await fetch(`/api/reviews/${id}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment, outcomeCode: outcome || null }),
    })
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-700" />
    </div>
  )
  if (!ctx) return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/reviews" className="btn-secondary text-xs py-1.5 px-3"><ArrowLeft className="h-3.5 w-3.5" /> My Reviews</Link>
      <div className="card p-8 text-center text-slate-400">Review task not found or you are not assigned to this review.</div>
    </div>
  )

  const { task, docChain, myBatchTasks, previousRevisions, isLastReviewer } = ctx
  const dv    = task.document_versions ?? {}
  // The in-app viewer/markup is PDF-only. For any other format (Word, Excel, etc.)
  // hide "Open & Markup" — such files can only be opened in SharePoint.
  const isPdf = /\.pdf$/i.test((dv as any).file_name || (dv as any).central_file_url || '')
  const batch = dv.batches ?? {}
  // Internal/As-Built reviews use the reduced A1/B1/Q1 set; redlines are a plain
  // Accept/Reject pair; client/vendor reviews keep the full list.
  const isInternal = batch.source === 'internal' || batch.source === 'asbuilt' || batch.source === 'internal_review'
  const isRedline  = batch.source === 'redline'
  const outcomeOptions = isRedline ? REDLINE_OUTCOME_CODES : isInternal ? INTERNAL_OUTCOME_CODES : OUTCOME_CODES
  const isCompleted = task.status === 'completed' || submitted
  // Turn-order: an open step BEFORE mine (e.g. a re-review I sent back) blocks my
  // submission — otherwise the last reviewer can consume their "final look" slot
  // early and the batch closes without them (the Marnus case, 2026-07-29).
  const OPEN_ANY = ['pending', 'sent', 'opened', 'in_progress', 'overdue', 'needs_more_review']
  const earlierOpen = docChain.filter((t: any) =>
    t.sequence_number < task.sequence_number && OPEN_ANY.includes(t.status))
  // 'overdue' is a LATE-but-still-active state (a reminder cron flips a past-due task to
  // it) — the reviewer must still be able to submit. It was missing here, so once a task
  // went overdue the whole review form + add-reviewer control disappeared (Jarrod, Aug'26).
  // OPEN_ANY above already treats overdue as open for the turn-order guard, which still applies.
  const canSubmit   = ['sent','opened','in_progress','pending','overdue'].includes(task.status) && !submitted && earlierOpen.length === 0

  // Previous reviewers who already completed (visible to current reviewer)
  const completedBefore = docChain.filter((t: any) =>
    t.sequence_number < task.sequence_number && t.status === 'completed'
  )
  // Pending/future reviewers
  const futureReviewers = docChain.filter((t: any) =>
    t.sequence_number > task.sequence_number
  )

  // Directory options for the add-reviewer picker. Reviewers with an OPEN task
  // are excluded (they'll see the document anyway); reviewers who already
  // COMPLETED may be selected again = a re-review loop-back (ruled 2026-07-28).
  const openStatuses = ['pending', 'sent', 'opened', 'in_progress', 'overdue', 'needs_more_review']
  const openEmails = new Set<string>(docChain
    .filter((t: any) => openStatuses.includes(t.status))
    .map((t: any) => (t.reviewer_email ?? '').toLowerCase()))
  const completedEmails = new Set<string>(docChain
    .filter((t: any) => t.status === 'completed')
    .map((t: any) => (t.reviewer_email ?? '').toLowerCase()))
  const reviewerQuery = reviewerSearch.trim().toLowerCase()
  const matchedUsers = projectUsers
    .filter(u => !openEmails.has((u.email ?? '').toLowerCase()))
    .filter(u => (u.email ?? '').toLowerCase() !== (task.reviewer_email ?? '').toLowerCase())
    .filter(u => !reviewerQuery ||
      (u.email ?? '').toLowerCase().includes(reviewerQuery) ||
      (u.full_name ?? '').toLowerCase().includes(reviewerQuery))
    .slice(0, 8)

  if (submitted) return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/reviews" className="btn-secondary text-xs py-1.5 px-3"><ArrowLeft className="h-3.5 w-3.5" /> My Reviews</Link>
      <div className="card p-10 text-center">
        <CheckCircle className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Review Submitted</h2>
        <p className="text-slate-500 mb-1">Outcome: <strong>{outcome || 'Escalated for more review'}</strong></p>
        <p className="text-slate-400 text-sm">
          {!outcome ? 'The document controller has been notified that the chain is on hold. You can add the reviewer you need yourself — they slot in ahead of you and the review returns to you afterwards.'
            : isLastReviewer ? 'You were the final reviewer. The document controller has been notified.' : 'The next reviewer has been notified automatically.'}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link href="/reviews" className="btn-primary inline-flex">Back to My Reviews</Link>
          {!outcome && (
            <button onClick={() => { setSubmitted(false); loadContext() }} className="btn-secondary inline-flex">
              Add the reviewer I need
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4 max-w-4xl">
      {/* In-app Office viewer — the real Word/Excel runs inside our window (read-only).
          Closing this returns to the review; the user never lands in the SharePoint library. */}
      {showOffice && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 flex flex-col p-3 sm:p-6">
          <div className="flex items-center justify-between text-white mb-2 shrink-0 gap-3">
            <span className="text-sm font-medium flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 shrink-0" /> <span className="truncate">{dv.file_name}</span>
              {officeUrl && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 bg-white/20">
                  Read-only preview
                </span>
              )}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {/* The preview itself is Microsoft's page in a cross-origin iframe — we cannot
                  see when IT fails (e.g. "A network change was detected."), so the escape
                  hatches must always be on screen once the frame is mounted. */}
              {officeUrl && (
                <>
                  <button onClick={() => { if (officeDvId) openOfficeViewer(officeDvId) }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm">
                    <RefreshCw className="h-4 w-4" /> Reload preview
                  </button>
                  <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm">
                    <ExternalLink className="h-4 w-4" /> Open in SharePoint
                  </a>
                </>
              )}
              {officeEditHref && (
                <a href={officeEditHref} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/90 hover:bg-emerald-500 px-3 py-1.5 text-sm font-medium">
                  <ExternalLink className="h-4 w-4" /> Edit in Word / Excel
                </a>
              )}
              <button onClick={() => { setShowOffice(false); setOfficeUrl('') }} className="inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm">
                <X className="h-4 w-4" /> Close
              </button>
            </div>
          </div>
          {officeUrl && (
            <p className="text-[11px] text-white/70 mb-2 shrink-0">
              The preview is served by Microsoft Office for the web. If it shows a Microsoft error
              (e.g. “A network change was detected.”), use <strong>Reload preview</strong> — or
              <strong> Open in SharePoint</strong> to read the document in a new tab. Your review comments
              and outcome are still recorded here.
            </p>
          )}
          <div className="flex-1 min-h-0 rounded-lg overflow-hidden bg-white">
            {officeLoading ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">Opening document…</div>
            ) : officeError ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-6">
                <p className="text-sm text-red-600">{officeError}</p>
                <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
                  <ExternalLink className="h-4 w-4" /> Open in SharePoint instead
                </a>
              </div>
            ) : officeUrl ? (
              <iframe src={officeUrl} className="w-full h-full border-0" title={dv.file_name} />
            ) : null}
          </div>
        </div>
      )}

      {/* Back + multi-doc nav */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/reviews" className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> My Reviews
        </Link>
        {myBatchTasks.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-500">Documents in this batch:</span>
            {myBatchTasks.map((t: any) => (
              <Link key={t.id} href={`/reviews/${t.id}`}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  t.id === id
                    ? 'bg-navy-700 text-white border-navy-700'
                    : t.status === 'completed'
                    ? 'bg-green-100 text-emerald-700 border-green-200 hover:bg-green-200'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}>
                {(t.document_versions as any)?.file_name?.replace(/\.[^.]+$/, '').slice(-20) ?? `Doc ${t.id.slice(0, 6)}`}
                {t.review_outcome_code && <span className="ml-1 font-bold">{t.review_outcome_code}</span>}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Document header */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-mono text-sm font-semibold text-slate-900">{dv.file_name}</span>
              {dv.revision && (
                <span className="px-2 py-0.5 bg-navy-600 text-white rounded text-xs font-mono font-bold">
                  Rev {dv.revision}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                isCompleted ? 'bg-green-100 text-emerald-700' :
                task.status === 'overdue' ? 'bg-red-100 text-red-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                {isCompleted ? 'Completed' : task.status}
              </span>
              {task.is_manager_override && (
                <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-semibold">Manager Override</span>
              )}
            </div>
            {dv.doc_name && <p className="text-slate-700 font-medium">{dv.doc_name}</p>}
            <div className="flex flex-wrap gap-x-4 text-sm text-slate-500 mt-1">
              {batch.packages?.package_name && <span>{batch.packages.package_name}</span>}
              {dv.discipline    && <span>· {dv.discipline}</span>}
              {dv.document_type && <span>· {dv.document_type}</span>}
              <span>· You are reviewer {task.sequence_number} of {docChain.length}</span>
              {task.due_date && (
                <span className={new Date(task.due_date) < new Date() ? 'text-red-600 font-semibold' : ''}>
                  · Due {format(new Date(task.due_date), 'd MMM yyyy')}
                  {new Date(task.due_date) < new Date() ? ' ⚠️ OVERDUE' : ''}
                </span>
              )}
            </div>
          </div>

          {/* OPEN DOCUMENT BUTTON */}
          <div className="flex flex-col gap-2 shrink-0">
            {dv.central_file_url ? (
              ctx.markupMode === 'sharepoint' ? (
                <>
                  <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer" className="btn-primary">
                    <ExternalLink className="h-4 w-4" /> Open Document
                  </a>
                  {ctx.canMarkupBeta && isPdf && (
                    <Link href={`/reviews/${id}/markup`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                      🖊 Markup in-app (beta)
                    </Link>
                  )}
                </>
              ) : (
                <>
                  {isPdf && <Link href={`/reviews/${id}/markup`} className="btn-primary">🖊 Open &amp; Markup</Link>}
                  {/* Word / Excel: view the real document IN-APP (Office for the web in our
                      window) — no SharePoint landing on close. */}
                  {!isPdf && (
                    <button onClick={() => openOfficeViewer(dv.id)} className="btn-primary">
                      <FileText className="h-4 w-4" /> View document
                    </button>
                  )}
                  <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    <ExternalLink className="h-3.5 w-3.5" /> Open in SharePoint
                  </a>
                  {!isPdf && (
                    <span className="text-right text-[11px] text-slate-400">Opens the real Word/Excel in our window · review by comments below.</span>
                  )}
                </>
              )
            ) : (
              <div className="text-xs text-slate-400 max-w-[160px] text-right">
                Document URL not yet available — check back shortly after the file has been processed.
              </div>
            )}
          </div>
        </div>

        {/* AI Summary */}
        {dv.ai_text && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-md text-sm text-teal-800">
            <p className="font-semibold mb-1">AI Summary</p>
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{dv.ai_text}</pre>
          </div>
        )}
      </div>

      {/* ── REVIEWER CHAIN PANEL ─────────────────────────────────────────────── */}
      <div className="card">
        <button onClick={() => setShowChain(!showChain)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-500" />
            <span className="font-semibold text-slate-900">Review Chain ({docChain.length} reviewer{docChain.length !== 1 ? 's' : ''})</span>
            {completedBefore.length > 0 && (
              <span className="px-2 py-0.5 bg-green-100 text-emerald-700 rounded text-xs">{completedBefore.length} completed</span>
            )}
          </div>
          {showChain ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>

        {showChain && (
          <div className="border-t border-slate-100">
            <div className="divide-y divide-slate-50">
              {docChain.map((t: any) => {
                const isMe = t.id === id
                const isDone = t.status === 'completed'
                const isCurrent = isMe
                // Re-review round: same reviewer appearing again later in the chain
                const round = docChain.filter((o: any) =>
                  (o.reviewer_email ?? '').toLowerCase() === (t.reviewer_email ?? '').toLowerCase() &&
                  o.sequence_number <= t.sequence_number).length
                return (
                  <div key={t.id} className={`px-5 py-3 flex items-start gap-3 ${isCurrent ? 'bg-navy-50' : ''}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      isDone ? 'bg-emerald-500 text-white' :
                      isCurrent ? 'bg-navy-700 text-white' :
                      'bg-slate-200 text-slate-500'
                    }`}>
                      {t.sequence_number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-900">{reviewerName(t.reviewer_email)}</span>
                        <span className="text-xs text-slate-400">{t.reviewer_email}</span>
                        {isCurrent && <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-semibold">You</span>}
                        {round > 1 && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">↩ Round {round}</span>}
                        {t.review_outcome_code && (
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${OUTCOME_COLORS[t.review_outcome_code] ?? 'bg-slate-100 text-slate-600'}`}>
                            {t.review_outcome_code}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          isDone ? 'bg-green-100 text-emerald-600' :
                          t.status === 'sent' ? 'bg-blue-100 text-teal-600' :
                          isCurrent ? 'bg-amber-100 text-amber-600' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {isDone ? 'Completed' : isCurrent ? 'In progress' : t.status === 'sent' ? 'Notified' : 'Pending'}
                        </span>
                      </div>
                      {/* Show comment from previous reviewers */}
                      {isDone && t.comment && (
                        <div className="mt-1 text-xs text-slate-600 bg-slate-50 rounded px-2 py-1.5 italic">
                          "{t.comment}"
                        </div>
                      )}
                      {isDone && t.date_completed && (
                        <p className="text-xs text-slate-400 mt-0.5">Completed {format(new Date(t.date_completed), 'd MMM yyyy')}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Add reviewer button — also available while escalated (needs_more_review):
                the added expert slots in ahead and the flow returns to this reviewer. */}
            {(canSubmit || (task.status === 'needs_more_review' && !submitted)) && (
              <div className="px-5 py-3 border-t border-slate-100">
                {!showAddReviewer ? (
                  <button onClick={() => setShowAddReviewer(true)}
                    className="flex items-center gap-2 text-sm text-navy-600 hover:text-navy-800 font-medium">
                    <Plus className="h-4 w-4" /> Add another reviewer to this batch
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">Add reviewer after your position ({task.sequence_number}):</p>
                    <p className="text-xs text-slate-400">
                      Someone who already reviewed can be selected again for a <b>re-review</b> — they slot in after you,
                      and anyone still to review (incl. the final reviewer) stays after them.
                      {futureReviewers.length === 0 && ' You are the last step, so the flow will return to you after their re-review.'}
                    </p>
                    {newReviewerEmail ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-navy-100 text-navy-700 px-2.5 py-1 text-xs font-medium">
                        {newReviewerName || reviewerName(newReviewerEmail)}
                        <span className="text-navy-400">·</span> {newReviewerEmail}
                        <button onClick={() => { setNewReviewerEmail(''); setNewReviewerName('') }}
                          className="ml-1 text-navy-400 hover:text-navy-700"><X className="h-3 w-3" /></button>
                      </span>
                    ) : (
                      <div>
                        <input value={reviewerSearch} onChange={e => setReviewerSearch(e.target.value)}
                          placeholder="Search project users by name or email…" className="input text-sm" autoFocus />
                        {reviewerSearch.trim() && (
                          <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm divide-y divide-slate-50">
                            {matchedUsers.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-slate-400">No matching project users.</p>
                            ) : matchedUsers.map(u => (
                              <button key={u.id} type="button"
                                onClick={() => { setNewReviewerEmail(u.email); setNewReviewerName(u.full_name ?? ''); setReviewerSearch('') }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-50">
                                <span className="flex items-center gap-2 text-sm text-slate-800">
                                  {u.full_name ?? u.email}
                                  {completedEmails.has((u.email ?? '').toLowerCase()) && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">↩ reviewed earlier — will re-review</span>
                                  )}
                                </span>
                                <span className="block text-xs text-slate-400">{u.email}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <input value={newReviewerReason} onChange={e => setNewReviewerReason(e.target.value)}
                      placeholder="Reason for adding reviewer (optional)" className="input text-sm" />
                    <div className="flex gap-2">
                      <button onClick={handleAddReviewer} disabled={addingReviewer || !newReviewerEmail}
                        className="btn-primary text-xs py-1.5">
                        {addingReviewer ? 'Adding…' : 'Add Reviewer'}
                      </button>
                      <button onClick={() => { setShowAddReviewer(false); setNewReviewerEmail(''); setNewReviewerName(''); setReviewerSearch(''); setNewReviewerReason('') }}
                        className="btn-secondary text-xs py-1.5">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── PREVIOUS REVISIONS PANEL ─────────────────────────────────────────── */}
      {previousRevisions.length > 0 && (
        <div className="card">
          <button onClick={() => setShowHistory(!showHistory)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" />
              <span className="font-semibold text-slate-900">Previous Revisions ({previousRevisions.length})</span>
              <span className="text-xs text-slate-400">— read-only reference</span>
            </div>
            {showHistory ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </button>

          {showHistory && (
            <div className="border-t border-slate-100 divide-y divide-slate-50">
              {previousRevisions.map((pv: any) => (
                <div key={pv.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-slate-700">{pv.file_name}</span>
                        {pv.revision && (
                          <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-xs font-mono font-bold">
                            Rev {pv.revision}
                          </span>
                        )}
                        <span className="text-xs text-slate-400">
                          {pv.returned_at ? `Returned ${format(new Date(pv.returned_at), 'd MMM yyyy')}` :
                           pv.uploaded_at ? `Uploaded ${format(new Date(pv.uploaded_at), 'd MMM yyyy')}` : ''}
                        </span>
                      </div>
                      {/* Show all reviewer outcomes for this revision */}
                      {pv.completedReviews?.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {pv.completedReviews.map((cr: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className={`px-1.5 py-0.5 rounded font-bold shrink-0 ${OUTCOME_COLORS[cr.review_outcome_code] ?? 'bg-slate-100 text-slate-500'}`}>
                                {cr.review_outcome_code ?? '—'}
                              </span>
                              <span className="font-medium text-slate-600 shrink-0">{reviewerName(cr.reviewer_email)}</span>
                              {cr.comment && <span className="text-slate-500 italic">"{cr.comment}"</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {pv.central_file_url && (
                      <a href={`/api/documents/${pv.id}/download-url`} target="_blank" rel="noopener noreferrer"
                        className="btn-secondary text-xs py-1.5 px-3 shrink-0">
                        <ExternalLink className="h-3.5 w-3.5" /> View Rev {pv.revision}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Turn-order hold: a re-review sits ahead of me — my slot stays reserved */}
      {!submitted && task.status !== 'completed' && earlierOpen.length > 0 && (
        <div className="card p-4 bg-amber-50 border-amber-200">
          <p className="text-sm font-semibold text-amber-900">
            ⏳ Waiting for {[...new Set(earlierOpen.map((t: any) => reviewerName(t.reviewer_email)))].join(', ')} to
            finish the re-review ahead of you.
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Your final review stays reserved — you'll be emailed when it returns to you, and you conclude the batch.
            Anything you type below the markup is kept as a draft in the meantime.
          </p>
        </div>
      )}

      {/* ── REVIEW FORM ──────────────────────────────────────────────────────── */}
      {canSubmit && (
        <>
          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-3">
              {isRedline ? 'Your decision on this redline' : 'Select Review Outcome'} <span className="text-red-500">*</span>
            </h2>
            {isRedline && (
              <p className="text-xs text-slate-500 -mt-2 mb-3">
                Accepting makes you responsible for the As-Built — the redline waits under your name
                (however long drafting takes) and you upload the corrected drawing from your dashboard when it returns.
              </p>
            )}
            <div className="space-y-2">
              {outcomeOptions.map(oc => (
                <label key={oc.code}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    outcome === oc.code ? oc.color + ' border-2' : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}>
                  <input type="radio" name="outcome" value={oc.code}
                    checked={outcome === oc.code} onChange={() => setOutcome(oc.code)} className="shrink-0" />
                  <span className="font-bold text-sm w-8 shrink-0">{oc.code}</span>
                  <span className="text-sm">{oc.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900">Review Comments</h2>
              <button onClick={saveDraft} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <Save className="h-3.5 w-3.5" /> Save Draft
              </button>
            </div>
            <textarea value={comment} onChange={e => setComment(e.target.value)}
              rows={5} className="input resize-none"
              placeholder="Add your technical review comments, markups, or concerns here…" />
          </div>

          {error && <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

          {/* SUBMIT BUTTON */}
          <div className="flex gap-3">
            <button onClick={handleSubmit} disabled={submitting || !outcome}
              className="btn-primary flex-1 justify-center py-3 text-base">
              <Send className="h-5 w-5" />
              {submitting ? 'Submitting…' :
               isLastReviewer
                 ? 'Complete Review — Notify Document Controller'
                 : `Submit — Send to Next Reviewer (${reviewerName(futureReviewers[0]?.reviewer_email ?? '')})`
              }
            </button>
          </div>

          {/* NEED MORE REVIEW */}
          <div className="card p-4">
            <button onClick={() => setShowNMR(!showNMR)}
              className="flex items-center gap-2 text-sm text-amber-700 font-medium hover:text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              Need More Review — Request additional technical input
            </button>
            {showNMR && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-slate-500">Explain why additional review is needed. The document controller will be notified and can add a reviewer.</p>
                <textarea value={nmrReason} onChange={e => setNmrReason(e.target.value)}
                  rows={3} className="input resize-none"
                  placeholder="Explain why additional review is needed…" />
                <button onClick={handleNMR} disabled={submitting}
                  className="btn-secondary text-amber-700 border-amber-300 hover:bg-amber-50">
                  <AlertTriangle className="h-4 w-4" />
                  Submit — Escalate for Additional Review
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Read-only completed view */}
      {isCompleted && !submitted && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-slate-900">Your Review (Submitted)</h2>
          {task.review_outcome_code && (
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1.5 rounded font-bold text-lg ${OUTCOME_COLORS[task.review_outcome_code] ?? 'bg-slate-100'}`}>
                {task.review_outcome_code}
              </span>
              <span className="text-slate-600 text-sm">
                {(outcomeOptions.find(o => o.code === task.review_outcome_code)
                  ?? OUTCOME_CODES.find(o => o.code === task.review_outcome_code))?.label}
              </span>
            </div>
          )}
          {task.comment && <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-md">{task.comment}</p>}
          {task.date_completed && (
            <p className="text-xs text-slate-400">Submitted {format(new Date(task.date_completed), 'd MMM yyyy HH:mm')}</p>
          )}
        </div>
      )}
    </div>
  )
}
