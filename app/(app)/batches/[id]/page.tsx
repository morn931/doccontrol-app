'use client'
import { useState, useEffect, useRef, use } from 'react'
import { ArrowLeft, FileText, Users, ExternalLink, AlertCircle, X, XCircle, Download, Loader2, CheckCircle2, Trash2, RotateCw, PenLine, Plus, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import CommentChecklist from '@/components/markup/comment-checklist'
import { format } from 'date-fns'
import { outcomeColorClass, OUTCOME_CODES } from '@/lib/utils/outcome-codes'
import type { ReviewOutcomeCode } from '@/lib/types/database'

const STATUS_COLORS: Record<string, string> = {
  intake_received:              'bg-blue-100 text-teal-800',
  metadata_pending:             'bg-amber-100 text-amber-800',
  ready_for_reviewer_assignment:'bg-indigo-100 text-indigo-800',
  review_ready_to_start:        'bg-teal-100 text-teal-800',
  review_in_progress:           'bg-amber-100 text-amber-800',
  review_complete:              'bg-teal-100 text-teal-800',
  transmittal_generated:        'bg-cyan-100 text-cyan-800',
  returned_to_vendor:           'bg-green-100 text-emerald-800',
  rejected_before_review:       'bg-red-100 text-red-800',
  cancelled:                    'bg-slate-100 text-slate-600',
  failed:                       'bg-red-200 text-red-900',
}
const STATUS_LABELS: Record<string, string> = {
  intake_received:              'Received',
  metadata_pending:             'Metadata Pending',
  ready_for_reviewer_assignment:'Ready to Assign',
  review_ready_to_start:        'Ready to Start',
  review_in_progress:           'In Review',
  review_complete:              'Review Complete',
  transmittal_generated:        'Transmittal Generated',
  returned_to_vendor:           'Returned to Vendor',
  rejected_before_review:       'Rejected',
  cancelled:                    'Cancelled',
  failed:                       'Failed',
}

function reviewerDisplayName(email: string): string {
  return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)   // Next.js 15: unwrap params Promise with React.use()

  const [batch, setBatch]           = useState<any>(null)
  const [reviewTasks, setReviewTasks] = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting]   = useState(false)
  const [rejectError, setRejectError] = useState('')
  const [rejectPreview, setRejectPreview] = useState<any>(null)   // dry-run manifest before confirm
  const [rejectVendorEmail, setRejectVendorEmail] = useState('')  // controller-confirmed reject recipient
  const [retrying, setRetrying]     = useState(false)
  const [redelivering, setRedelivering] = useState(false)   // return-to-vendor retry (files, not the email)
  const [redeliverMsg, setRedeliverMsg] = useState('')
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())
  const [rejectDocIds, setRejectDocIds] = useState<string[] | null>(null)  // null = whole batch
  const [retryingDoc, setRetryingDoc]   = useState<string | null>(null)
  const [showSignoff, setShowSignoff]   = useState(false)
  const [signatories, setSignatories]   = useState<{ role: string; name: string; email: string }[]>([{ role: 'Prepared', name: '', email: '' }])
  const [startingSignoff, setStartingSignoff] = useState(false)
  const [signoffError, setSignoffError] = useState('')
  const [resettingSignoff, setResettingSignoff] = useState(false)
  const [signoffOnlyBusy, setSignoffOnlyBusy] = useState(false)
  const [checklistDv, setChecklistDv] = useState<any>(null)   // document version whose reviewer-comment checklist is open
  const [officeDoc, setOfficeDoc] = useState<{ id: string; name: string } | null>(null)
  // Amend-outcome (Doc Control): correct a reviewer's submitted code after the fact.
  const [amendTaskId, setAmendTaskId] = useState<string | null>(null)
  const [amendCode, setAmendCode]     = useState<string>('')
  const [amendReason, setAmendReason] = useState('')
  const [amendSaving, setAmendSaving] = useState(false)
  const [amendMsg, setAmendMsg]       = useState<{ type: 'err' | 'ok'; text: string } | null>(null)
  const [officeUrl, setOfficeUrl] = useState('')
  const [officeLoading, setOfficeLoading] = useState(false)
  const [officeError, setOfficeError] = useState('')

  async function openOfficeViewer(dvId: string, name: string) {
    setOfficeDoc({ id: dvId, name }); setOfficeError(''); setOfficeUrl(''); setOfficeLoading(true)
    try {
      const res = await fetch(`/api/documents/${dvId}/office-embed`)
      const data = await res.json()
      if (!res.ok) { setOfficeError(data.error ?? 'Could not open the viewer'); return }
      setOfficeUrl(data.url)
    } catch (e: any) { setOfficeError(e.message ?? 'Unexpected error') } finally { setOfficeLoading(false) }
  }
  const transmittalRef = useRef<HTMLDivElement>(null)
  const [transmittalPreview, setTransmittalPreview]       = useState<any>(null)  // inline preview (before send)
  const [transmittalSent, setTransmittalSent]             = useState<any>(null)  // confirmed after send
  const [generatingPreview, setGeneratingPreview]         = useState(false)
  const [showTransmittalModal, setShowTransmittalModal]   = useState(false)
  const [toEmail, setToEmail]                             = useState('')
  const [ccEmails, setCcEmails]                           = useState<string[]>([])
  const [newCc, setNewCc]                                 = useState('')
  const [pastEmails, setPastEmails]                       = useState<string[]>([])
  const [defaultCc, setDefaultCc]                         = useState('')
  const [sending, setSending]                             = useState(false)
  const [transmittalError, setTransmittalError]           = useState('')
  const [destLibrary, setDestLibrary]                     = useState('')
  const [eng2Libraries, setEng2Libraries]                 = useState<string[]>([])
  const [loadingLibs, setLoadingLibs]                     = useState(false)

  useEffect(() => { loadBatch() }, [id])

  // Internal return: prefill the engineer email + load the ENG2 discipline libraries when the modal opens.
  useEffect(() => {
    if (showTransmittalModal && batch?.source === 'internal') {
      if (batch.engineer_email) setToEmail(prev => prev || batch.engineer_email)
      if (!eng2Libraries.length && !loadingLibs) {
        setLoadingLibs(true)
        fetch('/api/eng2-libraries').then(r => r.json())
          .then(d => { if (d.libraries) setEng2Libraries(d.libraries); else setTransmittalError(d.error ?? 'Could not load ENG2 libraries') })
          .catch(() => setTransmittalError('Could not load ENG2 libraries'))
          .finally(() => setLoadingLibs(false))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTransmittalModal, batch])

  // Scroll to transmittal view whenever it becomes visible
  useEffect(() => {
    if (transmittalPreview || transmittalSent) {
      setTimeout(() => transmittalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }, [transmittalPreview, transmittalSent])

  async function loadBatch() {
    setLoading(true)
    const res = await fetch(`/api/batches/${id}`)
    if (res.ok) {
      const data = await res.json()
      setBatch(data)
      // Load review tasks separately
      const rtRes = await fetch(`/api/review-tasks?batchId=${id}`)
      if (rtRes.ok) setReviewTasks(await rtRes.json())
    }
    setLoading(false)
  }

  function openAmend(task: any) {
    setAmendTaskId(task.id); setAmendCode(task.review_outcome_code ?? ''); setAmendReason(''); setAmendMsg(null)
  }
  async function saveAmend(taskId: string) {
    if (!amendCode) { setAmendMsg({ type: 'err', text: 'Pick an outcome code.' }); return }
    if (!amendReason.trim()) { setAmendMsg({ type: 'err', text: 'A reason is required.' }); return }
    setAmendSaving(true); setAmendMsg(null)
    try {
      const res = await fetch(`/api/batches/${id}/amend-outcome`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, newCode: amendCode, reason: amendReason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setAmendMsg({ type: 'err', text: data.error ?? 'Amend failed.' }); return }
      setAmendTaskId(null)
      await loadBatch()
      if (data.transmittalNeedsReissue) {
        setAmendMsg({ type: 'ok', text: `Outcome updated — batch overall is now ${data.batchWorst}. Transmittal ${data.transmittalNumber} no longer matches; re-issue the corrected transmittal to the vendor.` })
      } else {
        setAmendMsg({ type: 'ok', text: `Outcome updated — batch overall is now ${data.batchWorst}.` })
      }
    } catch (e: any) {
      setAmendMsg({ type: 'err', text: e?.message ?? 'Network error.' })
    } finally {
      setAmendSaving(false)
    }
  }

  function closeRejectModal() {
    setShowReject(false); setRejectReason(''); setRejectError(''); setRejectPreview(null); setRejectVendorEmail(''); setRejectDocIds(null)
  }

  function toggleDoc(dvId: string) {
    setSelectedDocs(prev => { const n = new Set(prev); n.has(dvId) ? n.delete(dvId) : n.add(dvId); return n })
  }

  // Open the reject modal for the whole batch (null) or a specific document set.
  function openReject(docIds: string[] | null) {
    setRejectDocIds(docIds)
    setRejectVendorEmail(batch.vendor_email || batch.vendors?.primary_contact_email || '')
    setRejectPreview(null); setRejectError(''); setRejectReason('')
    setShowReject(true)
  }

  // Retry the hard-delete cleanup for a single already-rejected document.
  async function handleStartSignoff() {
    const clean = signatories.map(s => ({ role: s.role.trim(), name: s.name.trim(), email: s.email.trim() })).filter(s => s.email.includes('@'))
    if (!clean.length) { setSignoffError('Add at least one signatory with an email.'); return }
    setStartingSignoff(true); setSignoffError('')
    try {
      const res = await fetch(`/api/batches/${id}/signoff/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatories: clean }),
      })
      const data = await res.json()
      if (!res.ok) { setSignoffError(data.error ?? 'Failed to start sign-off'); return }
      setShowSignoff(false); loadBatch()
    } catch (e: any) {
      setSignoffError(e.message ?? 'Unexpected error')
    } finally {
      setStartingSignoff(false)
    }
  }

  // Un-do a sign-off so it can be sent again (discards any signatures already applied).
  async function handleResetSignoff() {
    const signed = batch?.status === 'signed'
    if (!window.confirm(signed
      ? 'This document is fully signed. Reset the sign-off? The current signature(s) will be cleared and you can send it for signing again.'
      : 'Reset the sign-off? Any signatures already applied will be cleared and the document returns to "review complete" so you can send it again.')) return
    setResettingSignoff(true); setSignoffError('')
    try {
      const res = await fetch(`/api/batches/${id}/signoff/reset`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setSignoffError(data.error ?? 'Failed to reset sign-off'); return }
      loadBatch()
    } catch (e: any) {
      setSignoffError(e.message ?? 'Unexpected error')
    } finally {
      setResettingSignoff(false)
    }
  }

  // DC flags an owner's sign-off-only request straight to sign-off (skips review), or clears it.
  async function approveSignoffOnly() {
    if (!window.confirm('Send this document straight to sign-off, skipping the review cycle? Use this only for a revision that was already reviewed on Aconex.')) return
    setSignoffOnlyBusy(true); setSignoffError('')
    try {
      const res = await fetch(`/api/batches/${id}/signoff-only/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (!res.ok) { setSignoffError(data.error ?? 'Could not flag straight to sign-off'); return }
      loadBatch()
    } catch (e: any) { setSignoffError(e.message ?? 'Unexpected error') } finally { setSignoffOnlyBusy(false) }
  }
  async function clearSignoffOnly() {
    if (!window.confirm('Clear the sign-off-only request and send this document through the normal review instead?')) return
    setSignoffOnlyBusy(true); setSignoffError('')
    try {
      const res = await fetch(`/api/batches/${id}/signoff-only/clear`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setSignoffError(data.error ?? 'Could not clear the request'); return }
      loadBatch()
    } catch (e: any) { setSignoffError(e.message ?? 'Unexpected error') } finally { setSignoffOnlyBusy(false) }
  }

  async function handleRetryDoc(dvId: string) {
    setRetryingDoc(dvId)
    try {
      await fetch(`/api/batches/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentVersionIds: [dvId], commit: true }),
      })
      await loadBatch()
    } finally {
      setRetryingDoc(null)
    }
  }

  // Stage 1 — dry run: fetch the manifest of exactly what reject WOULD remove/close/email.
  async function handlePreviewReject() {
    if (!rejectReason.trim()) { setRejectError('Please enter a rejection reason'); return }
    setRejecting(true); setRejectError('')
    try {
      const res = await fetch(`/api/batches/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectReason, vendorEmail: rejectVendorEmail.trim(), documentVersionIds: rejectDocIds ?? undefined, commit: false }),
      })
      const data = await res.json()
      if (!res.ok) { setRejectError(data.error ?? 'Failed to build preview'); return }
      setRejectPreview(data)
    } catch (e: any) {
      setRejectError(e.message ?? 'Unexpected error')
    } finally {
      setRejecting(false)
    }
  }

  // Stage 2 — commit: perform the reject unwind (hard-deletes are irreversible).
  async function handleConfirmReject() {
    setRejecting(true); setRejectError('')
    try {
      const res = await fetch(`/api/batches/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectReason, vendorEmail: rejectVendorEmail.trim(), documentVersionIds: rejectDocIds ?? undefined, commit: true }),
      })
      const data = await res.json()
      if (!res.ok) { setRejectError(data.error ?? 'Failed'); return }
      setSelectedDocs(new Set()); closeRejectModal(); loadBatch()
    } catch (e: any) {
      setRejectError(e.message ?? 'Unexpected error')
    } finally {
      setRejecting(false)
    }
  }

  // Resume a partially-failed reject (idempotent — only the unfinished steps re-run).
  async function handleRetryCleanup() {
    setRetrying(true)
    try {
      await fetch(`/api/batches/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit: true }),
      })
      await loadBatch()
    } finally {
      setRetrying(false)
    }
  }

  async function handleGeneratePreview() {
    setGeneratingPreview(true)
    setTransmittalError('')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(`/api/batches/${id}/generate-transmittal`, { signal: controller.signal })
      const data = await res.json()
      if (!res.ok) {
        setTransmittalError(data.error ?? 'Failed to load transmittal')
        return
      }
      if (!data.preview) {
        setTransmittalError('No preview data returned — check Vercel function logs')
        return
      }
      setTransmittalPreview(data.preview)
      setTransmittalSent(null)
      setPastEmails(data.pastEmails ?? [])
      // Not added as a removable CC chip — the server always includes it regardless (see
      // generate-transmittal route), so a chip you could delete here was misleading: deleting it
      // didn't stop the controller being CC'd, and leaving it in place duplicated them. Shown as
      // a fixed note instead; this box is only for genuinely additional recipients.
      setDefaultCc(data.defaultCc ?? '')
    } catch (e: any) {
      setTransmittalError(
        e.name === 'AbortError' ? 'Request timed out after 30s — check Vercel logs' : (e.message ?? 'Unexpected error')
      )
    } finally {
      clearTimeout(timer)
      setGeneratingPreview(false)
    }
  }

  function openSendModal() {
    setTransmittalError('')
    setShowTransmittalModal(true)
  }

  // Re-run the file delivery for an already-issued transmittal (no new number, no new
  // email). The batch only reaches 'returned_to_vendor' when every document copies.
  async function handleRetryDelivery() {
    setRedelivering(true); setRedeliverMsg('')
    try {
      const res = await fetch(`/api/batches/${id}/return`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) { setRedeliverMsg(`Delivered ${data.copied}/${data.total} file(s) to ${data.returnLibrary ?? "the vendor's bucket"}.`); await loadBatch() }
      else setRedeliverMsg(`Delivery still failing — ${data.errors?.[0] ?? data.error ?? 'see the audit log'}`)
    } catch (e: any) {
      setRedeliverMsg(e.message ?? 'Unexpected error')
    } finally {
      setRedelivering(false)
    }
  }

  async function handleSendTransmittal() {
    const internal = batch?.source === 'internal'
    if (!toEmail.trim()) { setTransmittalError(internal ? 'Engineer email is required' : 'Vendor email is required'); return }
    if (internal && !destLibrary) { setTransmittalError('Select the ENG2 discipline library first.'); return }
    setSending(true); setTransmittalError('')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55_000) // 55s client timeout
    try {
      const res = await fetch(`/api/batches/${id}/generate-transmittal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail: toEmail.trim(), ccEmails: ccEmails.filter(Boolean), destLibrary: batch?.source === 'internal' ? destLibrary : undefined }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) { setTransmittalError(data.error ?? 'Failed to generate — check Vercel logs'); return }
      setTransmittalSent(data)
      setTransmittalPreview(null)
      setShowTransmittalModal(false)
      loadBatch()
    } catch (e: any) {
      if (e.name === 'AbortError') setTransmittalError('Timed out — try again. If this persists, contact support.')
      else setTransmittalError(e.message ?? 'Unexpected error')
    } finally {
      clearTimeout(timeout)
      setSending(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-700" />
    </div>
  )
  if (!batch) return <div className="card p-8 text-center text-slate-400">Batch not found.</div>

  const docVersions = batch.document_versions ?? []
  const isInternal = batch.source === 'internal'
  const statusColor = STATUS_COLORS[batch.status] ?? 'bg-slate-100 text-slate-600'
  const statusLabel = STATUS_LABELS[batch.status] ?? batch.status
  const canReject = ['intake_received','metadata_pending','ready_for_reviewer_assignment'].includes(batch.status)

  // Unique reviewers
  const reviewerMap = new Map<string, { email: string; minSeq: number; statuses: string[] }>()
  reviewTasks.forEach((t: any) => {
    const key = t.reviewer_email
    if (!reviewerMap.has(key)) reviewerMap.set(key, { email: key, minSeq: t.sequence_number, statuses: [t.status] })
    else { const e = reviewerMap.get(key)!; if (t.sequence_number < e.minSeq) e.minSeq = t.sequence_number; e.statuses.push(t.status) }
  })
  const uniqueReviewers = [...reviewerMap.values()].sort((a, b) => a.minSeq - b.minSeq)
  const docTitles = [...new Set(docVersions.map((dv: any) => dv.doc_name ?? dv.file_name).filter(Boolean))]

  return (
    <div className="space-y-6 max-w-5xl">
      {/* In-app Office viewer — Word/Excel run inside our window (read-only); close returns
          here, never to the SharePoint library. */}
      {officeDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 flex flex-col p-3 sm:p-6">
          <div className="flex items-center justify-between text-white mb-2 shrink-0">
            <span className="text-sm font-medium flex items-center gap-2"><FileText className="h-4 w-4" /> {officeDoc.name}</span>
            <button onClick={() => { setOfficeDoc(null); setOfficeUrl('') }} className="inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm">
              <X className="h-4 w-4" /> Close
            </button>
          </div>
          <div className="flex-1 min-h-0 rounded-lg overflow-hidden bg-white">
            {officeLoading ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">Opening document…</div>
              : officeError ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-6">
                  <p className="text-sm text-red-600">{officeError}</p>
                  <a href={`/api/documents/${officeDoc.id}/download-url`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm"><ExternalLink className="h-4 w-4" /> Open in SharePoint instead</a>
                </div>
              ) : officeUrl ? <iframe src={officeUrl} className="w-full h-full border-0" title={officeDoc.name} /> : null}
          </div>
        </div>
      )}

      {/* Back */}
      <div className="flex items-center gap-3">
        <Link href="/batches" className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Batches
        </Link>
      </div>

      {/* Undelivered transmittal — a transmittal email has gone out but the reviewed files did
          NOT all reach the vendor's bucket (the batch only reaches 'returned_to_vendor' once
          every file copies). This was silent in the Siemens PPE-TRN-2026-00095/00096 incident:
          the vendor's link pointed at an empty library and nobody could see it. */}
      {!isInternal && batch.status === 'transmittal_generated' && (
        <div className="card p-4 border-red-300 bg-red-50 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800">
              Transmittal issued, but the reviewed files have not been delivered to the vendor&apos;s SharePoint bucket.
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              The link the vendor received points at files that are not there. Retry the delivery —
              it re-copies every document (no new transmittal, no new email) and marks the batch
              returned once all of them land.
            </p>
            {redeliverMsg && <p className="text-xs mt-1.5 font-medium text-red-900">{redeliverMsg}</p>}
          </div>
          <button onClick={handleRetryDelivery} disabled={redelivering} className="btn-secondary text-xs py-1.5 px-3 shrink-0">
            {redelivering ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Delivering…</> : <><RotateCw className="h-3.5 w-3.5" /> Retry delivery</>}
          </button>
        </div>
      )}

      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">
                {batch.packages?.package_name ?? batch.packages?.package_code ?? 'Unknown Package'}
              </h1>
              <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${statusColor}`}>{statusLabel}</span>
            </div>

            {docTitles.slice(0, 3).map((t: any, i: number) => (
              <p key={i} className="text-sm text-slate-600 font-medium mt-1">{t}</p>
            ))}
            {docTitles.length > 3 && <p className="text-xs text-slate-400 mt-0.5">+{docTitles.length - 3} more</p>}

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
              <span><span className="font-medium text-slate-700">Package:</span> {batch.packages?.package_code ?? '—'}</span>
              <span><span className="font-medium text-slate-700">Received:</span> {format(new Date(batch.received_at), 'd MMM yyyy')}</span>
              <span><span className="font-medium text-slate-700">Documents:</span> {docVersions.length}</span>
              {batch.source === 'internal_review' && <span><span className="font-medium text-slate-700">Internal ref:</span> {batch.internal_ref ?? '—'}</span>}
              {batch.vendor_email && <span><span className="font-medium text-slate-700">Vendor email:</span> {batch.vendor_email}</span>}
            </div>

            {uniqueReviewers.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <span className="text-xs font-medium text-slate-500">Reviewers:</span>
                {uniqueReviewers.map((r, i) => {
                  const allDone  = r.statuses.every(s => s === 'completed')
                  const anyActive = r.statuses.some(s => ['sent','in_progress','opened'].includes(s))
                  return (
                    <span key={r.email} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${allDone ? 'bg-green-100 text-emerald-700' : anyActive ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      <span className="w-4 h-4 rounded-full bg-white bg-opacity-60 flex items-center justify-center font-bold text-xs">{i+1}</span>
                      {reviewerDisplayName(r.email)}
                    </span>
                  )
                })}
              </div>
            )}

            <p className="mt-3 text-xs text-slate-400 font-mono">{batch.batch_guid}</p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 shrink-0">
            {canReject && (
              <button onClick={() => openReject(null)} className="btn-danger text-sm">
                <XCircle className="h-4 w-4" /> Reject Batch
              </button>
            )}
            {['intake_received','metadata_pending','ready_for_reviewer_assignment'].includes(batch.status) && (
              <Link href={`/batches/${id}/assign`} className="btn-primary text-sm">
                <Users className="h-4 w-4" /> Assign Reviewers
              </Link>
            )}
            {['review_complete','transmittal_generated'].includes(batch.status) && batch.source !== 'internal_review' && (
              <button
                onClick={handleGeneratePreview}
                disabled={generatingPreview}
                className="btn-primary text-sm flex items-center gap-2 justify-center"
              >
                {generatingPreview
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                  : <><FileText className="h-4 w-4" />
                    {batch.status === 'transmittal_generated' ? 'View / Re-send Transmittal' : 'Generate Transmittal'}
                  </>
                }
              </button>
            )}
            {['internal', 'internal_review'].includes(batch.source) && ['review_complete','signoff_declined','transmittal_generated'].includes(batch.status) && (
              <button onClick={() => { setSignoffError(''); setShowSignoff(true) }} className="btn-primary text-sm">
                <PenLine className="h-4 w-4" /> {batch.status === 'signoff_declined' ? 'Re-send for sign-off' : 'Send for sign-off'}
              </button>
            )}
            {/* DC acts on an owner's "sign-off only" request (returned from Aconex, already reviewed) */}
            {['internal', 'internal_review'].includes(batch.source) && batch.signoff_only_requested_by && !batch.signoff_only
              && ['metadata_pending','review_ready_to_start','review_in_progress'].includes(batch.status) && batch.viewer_can_signoff_only && (
              <>
                <button onClick={approveSignoffOnly} disabled={signoffOnlyBusy} className="btn-primary text-sm">
                  <PenLine className="h-4 w-4" /> {signoffOnlyBusy ? 'Working…' : 'Skip review → sign-off'}
                </button>
                <button onClick={clearSignoffOnly} disabled={signoffOnlyBusy} className="btn-secondary text-sm">
                  Clear request (send to review)
                </button>
              </>
            )}
            {['internal', 'internal_review'].includes(batch.source) && ['signoff_in_progress','signed','signoff_declined'].includes(batch.status) && (
              <button onClick={handleResetSignoff} disabled={resettingSignoff} className="btn-secondary text-sm">
                <RotateCw className="h-4 w-4" /> {resettingSignoff ? 'Resetting…' : 'Reset sign-off'}
              </button>
            )}
          </div>
        </div>

        {(batch.signoff_only || batch.signoff_only_requested_by) && (
          <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${batch.signoff_only ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {batch.signoff_only ? (
              <><span className="font-semibold">Sign-off only — review skipped.</span> {batch.signoff_only_reason ?? 'Returned from Aconex, already reviewed.'}{batch.signoff_only_approved_by ? ` (flagged by ${batch.signoff_only_approved_by})` : ''}</>
            ) : (
              <><span className="font-semibold">Sign-off only requested{batch.signoff_only_requested_by ? ` by ${batch.signoff_only_requested_by}` : ''}.</span> {batch.signoff_only_reason ?? ''} {batch.viewer_can_signoff_only ? 'Use “Skip review → sign-off” above, or clear the request to send it through the normal review.' : 'A Document Controller will flag it straight to sign-off, or send it through review.'}</>
            )}
          </div>
        )}

        {batch.comments && (
          <div className="mt-4 p-3 bg-blue-50 rounded-md text-sm text-teal-800 border border-blue-100">
            <p className="font-medium mb-1">Controller Notes</p>
            <p>{batch.comments}</p>
          </div>
        )}
        {batch.reject_reason && (
          <div className="mt-4 p-3 bg-red-50 rounded-md text-sm text-red-800 border border-red-100">
            <p className="font-medium mb-1 flex items-center gap-1"><AlertCircle className="h-4 w-4" /> Rejection Reason</p>
            <p>{batch.reject_reason}</p>
          </div>
        )}

        {/* Reject cleanup status — what the unwind removed / still needs retrying */}
        {batch.status === 'rejected_before_review' && (() => {
          const vendorEmailResolved = batch.vendor_email || batch.vendors?.primary_contact_email || ''
          const notifyDone = batch.reject_vendor_notified || !vendorEmailResolved
          const steps = [
            { label: 'PPE approval-bucket copies deleted', done: batch.reject_bucket_deleted },
            { label: 'Vendor copy moved to Rejected Files', done: batch.reject_source_deleted },
            { label: 'Approver Picks row closed',          done: batch.reject_picks_closed },
            { label: vendorEmailResolved ? 'Vendor notified by email' : 'Vendor notified (no email on file — skipped)', done: notifyDone },
          ]
          const allDone = steps.every(s => s.done) && !batch.reject_cleanup_error
          return (
            <div className={`mt-4 p-3 rounded-md text-sm border ${allDone ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className={`font-medium flex items-center gap-1.5 ${allDone ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {allDone ? <><CheckCircle2 className="h-4 w-4" /> Cleanup complete — all traces removed</> : <><AlertCircle className="h-4 w-4" /> Cleanup incomplete</>}
                </p>
                {!allDone && (
                  <button onClick={handleRetryCleanup} disabled={retrying} className="btn-secondary text-xs py-1 px-2.5">
                    {retrying ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Retrying…</> : <><RotateCw className="h-3.5 w-3.5" /> Retry cleanup</>}
                  </button>
                )}
              </div>
              <ul className="space-y-1">
                {steps.map((s, i) => (
                  <li key={i} className={`flex items-center gap-2 ${s.done ? 'text-slate-600' : 'text-slate-500'}`}>
                    {s.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                    {s.label}
                  </li>
                ))}
              </ul>
              {batch.reject_cleanup_error && (
                <p className="mt-2 text-xs text-red-700 break-words"><span className="font-medium">Last error:</span> {batch.reject_cleanup_error}</p>
              )}
            </div>
          )
        })()}
      </div>

      {/* Transmittal error banner */}
      {transmittalError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{transmittalError}</span>
          <button onClick={() => setTransmittalError('')} className="ml-auto shrink-0"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Send-for-sign-off modal */}
      {showSignoff && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2"><PenLine className="h-5 w-5 text-teal-600" /> Send for sign-off</h2>
              <button onClick={() => setShowSignoff(false)}><X className="h-5 w-5 text-slate-400 hover:text-slate-600" /></button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              The document is converted to PDF and routed to each signatory in order to sign <strong>in the app</strong>.
              The native file is untouched. Preview the PDF first — especially for Excel.
            </p>

            <datalist id="signoff-roles"><option value="Prepared" /><option value="Checked" /><option value="Approved" /><option value="Reviewed" /></datalist>
            <div className="space-y-2">
              {signatories.map((s, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <span className="w-5 text-xs text-slate-400 shrink-0">{i + 1}.</span>
                  <input list="signoff-roles" value={s.role} onChange={e => setSignatories(sig => sig.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} placeholder="Role" className="input text-sm w-28 shrink-0" />
                  <input value={s.name} onChange={e => setSignatories(sig => sig.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Name" className="input text-sm flex-1" />
                  <input type="email" value={s.email} onChange={e => setSignatories(sig => sig.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} placeholder="email@ppetech.co.za" className="input text-sm flex-1" />
                  <button onClick={() => setSignatories(sig => sig.filter((_, j) => j !== i))} disabled={signatories.length === 1} className="text-slate-400 hover:text-red-500 disabled:opacity-30 shrink-0"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setSignatories(sig => [...sig, { role: '', name: '', email: '' }])} className="btn-secondary text-xs py-1.5 px-3 mt-2">
              <Plus className="h-3.5 w-3.5" /> Add signatory
            </button>

            {signoffError && <p className="text-sm text-red-600 mt-3">{signoffError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={handleStartSignoff} disabled={startingSignoff} className="btn-primary flex-1 justify-center">
                {startingSignoff ? <><Loader2 className="h-4 w-4 animate-spin" /> Preparing…</> : <><PenLine className="h-4 w-4" /> Send for sign-off</>}
              </button>
              <a href={`/api/batches/${id}/signoff/preview`} target="_blank" rel="noopener noreferrer" className="btn-secondary justify-center px-4">
                <FileText className="h-4 w-4" /> Preview PDF
              </a>
              <button onClick={() => setShowSignoff(false)} className="btn-secondary justify-center px-4">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal — two stages: reason → preview manifest → confirm hard-delete */}
      {showReject && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                {rejectDocIds ? `Reject ${rejectDocIds.length} selected document${rejectDocIds.length === 1 ? '' : 's'}` : 'Reject Batch Before Review'}
              </h2>
              <button onClick={closeRejectModal}>
                <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {!rejectPreview ? (
              // ── Stage 1: reason ──────────────────────────────────────────────
              <>
                <p className="text-sm text-slate-600 mb-4">
                  The vendor will be notified by email. Provide a clear reason so they can correct and resubmit.
                  You'll see exactly what will be removed before anything is deleted.
                </p>
                <label className="label">Rejection Reason <span className="text-red-500">*</span></label>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={4}
                  className="input resize-none"
                  placeholder="e.g. Wrong document type on cover page. Title block does not match SDDR. Please correct and resubmit."
                />
                <label className="label mt-3">Notify vendor at</label>
                <input
                  type="email"
                  value={rejectVendorEmail}
                  onChange={e => setRejectVendorEmail(e.target.value)}
                  className="input"
                  placeholder="vendor@company.com — no address on file; enter one to notify"
                />
                <p className="mt-1 text-xs text-slate-400">
                  {rejectVendorEmail ? 'Saved to the batch so it sticks for retries.' : 'Leave blank to reject without emailing the vendor.'}
                </p>
                {rejectError && <p className="text-sm text-red-600 mt-2">{rejectError}</p>}
                <div className="flex gap-3 mt-4">
                  <button onClick={handlePreviewReject} disabled={rejecting} className="btn-danger flex-1 justify-center">
                    {rejecting ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</> : <>Preview reject</>}
                  </button>
                  <button onClick={closeRejectModal} className="btn-secondary flex-1 justify-center">Cancel</button>
                </div>
              </>
            ) : (
              // ── Stage 2: manifest preview + confirm ──────────────────────────
              <>
                <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  <p className="font-medium flex items-center gap-1.5"><Trash2 className="h-4 w-4" /> PPE's approval-bucket copies are permanently deleted; the vendor's copies are moved to a "Rejected Files" folder (not deleted).</p>
                  <p className="mt-1 text-xs">
                    Scope: <b>{rejectPreview.manifest.scope}</b>
                    {!rejectPreview.wholeBatch && ' — the remaining documents keep moving through review.'}
                  </p>
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-700 mb-1">Hard-delete from PPE approval bucket ({rejectPreview.manifest.bucketFiles.length})</p>
                    {rejectPreview.manifest.bucketFiles.length
                      ? <ul className="list-disc pl-5 text-slate-600 space-y-0.5">{rejectPreview.manifest.bucketFiles.map((f: any, i: number) => <li key={i} className="font-mono text-xs break-all">{f.fileName}</li>)}</ul>
                      : <p className="text-slate-400 text-xs">Nothing recorded.</p>}
                  </div>
                  <div>
                    <p className="font-medium text-slate-700 mb-1">Move to the vendor's "Rejected Files" folder ({rejectPreview.manifest.vendorFiles.length})</p>
                    {rejectPreview.manifest.vendorFiles.length
                      ? <ul className="list-disc pl-5 text-slate-600 space-y-0.5">{rejectPreview.manifest.vendorFiles.map((f: any, i: number) => <li key={i} className="font-mono text-xs break-all">{f.fileName}</li>)}</ul>
                      : <p className="text-slate-400 text-xs">Nothing recorded — vendor must move their copy manually.</p>}
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-600">
                    <span><span className="font-medium text-slate-700">Approver Picks:</span> {rejectPreview.manifest.approverPicksRow}</span>
                    <span><span className="font-medium text-slate-700">Email to:</span> {rejectPreview.manifest.vendorEmail ?? '— none —'}</span>
                  </div>
                </div>

                {rejectPreview.warnings?.length > 0 && (
                  <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
                    {rejectPreview.warnings.map((w: string, i: number) => <p key={i} className="flex items-start gap-1.5"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}</p>)}
                  </div>
                )}

                {rejectError && <p className="text-sm text-red-600 mt-3">{rejectError}</p>}
                <div className="flex gap-3 mt-4">
                  <button onClick={handleConfirmReject} disabled={rejecting} className="btn-danger flex-1 justify-center">
                    {rejecting ? <><Loader2 className="h-4 w-4 animate-spin" /> Rejecting…</> : <><Trash2 className="h-4 w-4" /> Confirm — hard-delete &amp; reject</>}
                  </button>
                  <button onClick={() => setRejectPreview(null)} disabled={rejecting} className="btn-secondary flex-1 justify-center">Back</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sign-off status — the signature chain for an internal-review document */}
      {['internal', 'internal_review'].includes(batch.source) && (batch.signoff_tasks?.length ?? 0) > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <PenLine className="h-4 w-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Sign-off</h2>
            <span className={`ml-auto px-2.5 py-1 rounded-full text-xs font-medium ${
              batch.status === 'signed' ? 'bg-green-100 text-emerald-800' :
              batch.status === 'signoff_declined' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
              {batch.status === 'signed' ? 'Fully signed' : batch.status === 'signoff_declined' ? 'Declined' : 'In progress'}
            </span>
            {batch.signoff_pdf_url && (
              <a href={batch.signoff_pdf_url} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs py-1.5 px-3">
                <ExternalLink className="h-3.5 w-3.5" /> Open PDF
              </a>
            )}
          </div>
          <div className="divide-y divide-slate-50">
            {[...batch.signoff_tasks].sort((a: any, b: any) => a.sequence_number - b.sequence_number).map((t: any) => (
              <div key={t.id} className="px-6 py-3 flex items-center gap-4">
                <div className="w-7 h-7 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-bold text-xs shrink-0">{t.sequence_number}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-slate-900">{t.signatory_name || t.signatory_email} {t.role_label && <span className="text-slate-400 font-normal">· {t.role_label}</span>}</p>
                  <p className="text-xs text-slate-400">{t.signatory_email}</p>
                  {t.decline_reason && <p className="text-xs text-red-600 mt-0.5">Declined: {t.decline_reason}</p>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                  t.status === 'signed' ? 'bg-green-100 text-emerald-700' :
                  t.status === 'declined' ? 'bg-red-100 text-red-700' :
                  t.status === 'sent' || t.status === 'opened' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                  {t.status}{t.signed_at ? ` · ${format(new Date(t.signed_at), 'd MMM')}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Documents */}
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-900">Documents ({docVersions.length})</h2>
          {canReject && selectedDocs.size > 0 && (
            <button onClick={() => openReject([...selectedDocs])} className="btn-danger text-xs py-1.5 px-3 ml-auto">
              <XCircle className="h-3.5 w-3.5" /> Reject selected ({selectedDocs.size})
            </button>
          )}
          {uniqueReviewers.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-1.5">
              {uniqueReviewers.map((r, i) => {
                const allDone = r.statuses.every(s => s === 'completed')
                const anyActive = r.statuses.some(s => ['sent','in_progress','opened'].includes(s))
                return (
                  <span key={r.email} className={`px-2 py-0.5 rounded-full text-xs font-medium ${allDone ? 'bg-green-100 text-emerald-700' : anyActive ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`} title={r.email}>
                    {i+1}. {reviewerDisplayName(r.email)}
                  </span>
                )
              })}
            </div>
          )}
        </div>

        <div className="divide-y divide-slate-50">
          {docVersions.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-400 text-sm">No documents linked yet.</div>
          ) : docVersions.map((dv: any) => (
            <div key={dv.id} className="px-6 py-4">
                <div className="flex items-start gap-3">
                  {canReject && !dv.is_rejected && (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-red-600 cursor-pointer shrink-0"
                      checked={selectedDocs.has(dv.id)}
                      onChange={() => toggleDoc(dv.id)}
                      title="Select for rejection"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-mono text-sm font-semibold ${dv.is_rejected ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{dv.file_name}</span>
                      {dv.revision && <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">Rev {dv.revision}</span>}
                      {dv.is_rejected ? (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Rejected</span>
                      ) : (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          dv.ai_metadata_source === 'manually_overridden' ? 'bg-teal-100 text-teal-700' :
                          dv.ai_metadata_source === 'manually_confirmed'  ? 'bg-blue-100 text-teal-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {dv.ai_metadata_source === 'manually_overridden' ? 'Manual' : dv.ai_metadata_source === 'manually_confirmed' ? 'AI (confirmed)' : 'AI'}
                        </span>
                      )}
                    </div>
                    {dv.doc_name && dv.doc_name !== dv.file_name && <p className="text-sm text-slate-700 font-medium mt-0.5">{dv.doc_name}</p>}
                    <div className="flex flex-wrap gap-x-3 text-xs text-slate-400 mt-0.5">
                      {dv.discipline    && <span>{dv.discipline}</span>}
                      {dv.document_type && <span>· {dv.document_type}</span>}
                      {dv.topic         && <span>· {dv.topic}</span>}
                    </div>
                    {dv.is_rejected && dv.reject_reason && <p className="text-xs text-red-600 mt-0.5">{dv.reject_reason}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0 items-center">
                    {dv.is_rejected ? (
                      (dv.reject_bucket_deleted && dv.reject_source_deleted) ? (
                        <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Cleared</span>
                      ) : (
                        <button onClick={() => handleRetryDoc(dv.id)} disabled={retryingDoc === dv.id} className="btn-secondary text-xs py-1.5 px-3">
                          {retryingDoc === dv.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Retrying…</> : <><RotateCw className="h-3.5 w-3.5" /> Retry cleanup</>}
                        </button>
                      )
                    ) : (
                      <>
                        {dv.central_file_url && !/\.pdf$/i.test(dv.file_name || dv.central_file_url) && (
                          <button onClick={() => openOfficeViewer(dv.id, dv.file_name)} className="btn-secondary text-xs py-1.5 px-3">
                            <FileText className="h-3.5 w-3.5" /> View
                          </button>
                        )}
                        {dv.central_file_url && /\.pdf$/i.test(dv.file_name || dv.central_file_url) && (
                          <button onClick={() => setChecklistDv(dv)} className="btn-secondary text-xs py-1.5 px-3"
                            title="Work through the reviewers' comments as a checklist, jumping to each mark">
                            <MessageSquare className="h-3.5 w-3.5" /> Comments
                          </button>
                        )}
                        {dv.central_file_url && (
                          <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs py-1.5 px-3">
                            <ExternalLink className="h-3.5 w-3.5" /> Open
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reviewer-comment checklist (originator works through comments, jumping to each mark) */}
      {checklistDv && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setChecklistDv(null)}>
          <div className="bg-white rounded-xl shadow-xl w-[96vw] h-[93vh] p-4 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-900">Reviewer comments — <span className="font-mono">{checklistDv.file_name}</span></h3>
              <button onClick={() => setChecklistDv(null)} className="text-slate-400 hover:text-slate-700 text-sm">✕ Close</button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <CommentChecklist documentVersionId={checklistDv.id} fileSrc={`/api/documents/${checklistDv.id}/file`} fileName={checklistDv.file_name} />
            </div>
          </div>
        </div>
      )}

      {/* Transmittal modal */}
      {showTransmittalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Download className="h-5 w-5 text-teal-600" />
                {isInternal ? 'Return to Engineer' : `Send Transmittal — ${batch.packages?.package_name ?? ''}`}
              </h2>
              <button onClick={() => { setShowTransmittalModal(false); setTransmittalError('') }}>
                <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {/* To */}
            <div className="mb-4">
              <label className="label">{isInternal ? 'To (Engineer)' : 'To (Vendor Email)'} <span className="text-red-500">*</span></label>
              <input
                list="past-emails"
                type="email"
                value={toEmail}
                onChange={e => setToEmail(e.target.value)}
                className="input"
                placeholder={isInternal ? 'engineer@ppetech.co.za' : 'vendor@company.com'}
                autoFocus
              />
              <datalist id="past-emails">
                {pastEmails.map(e => <option key={e} value={e} />)}
              </datalist>
            </div>

            {/* Interlock: internal docs must be placed into an ENG2 discipline library first */}
            {isInternal && (
              <div className="mb-4">
                <label className="label">Save to ENG2 discipline library <span className="text-red-500">*</span></label>
                <select
                  value={destLibrary}
                  onChange={e => setDestLibrary(e.target.value)}
                  className="input"
                  disabled={loadingLibs}
                >
                  <option value="">{loadingLibs ? 'Loading libraries…' : '— select where the reviewed doc goes —'}</option>
                  {eng2Libraries.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  The reviewed, marked-up document is copied here, and the link is embedded in the transmittal to the engineer.
                </p>
              </div>
            )}

            {/* CC */}
            <div className="mb-4">
              <label className="label">CC</label>
              {defaultCc && (
                <p className="mb-2 text-xs text-slate-400">Doc Control ({defaultCc}) is always CC'd automatically — add anyone else below.</p>
              )}
              <div className="flex flex-wrap gap-2 mb-2">
                {ccEmails.map((email, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-teal-700 rounded-full text-sm">
                    {email}
                    <button onClick={() => setCcEmails(ccEmails.filter((_,j) => j !== i))} className="hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newCc}
                  onChange={e => setNewCc(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newCc.trim()) { setCcEmails([...ccEmails, newCc.trim()]); setNewCc('') } }}
                  className="input text-sm flex-1"
                  placeholder="Add CC email and press Enter"
                />
                <button
                  onClick={() => { if (newCc.trim()) { setCcEmails([...ccEmails, newCc.trim()]); setNewCc('') } }}
                  className="btn-secondary text-sm px-3"
                >+ Add</button>
              </div>
            </div>

            {/* Info note */}
            <div className="mb-5 p-3 bg-blue-50 rounded-lg text-sm text-teal-800">
              {isInternal
                ? 'The reviewed document is copied into the selected ENG2 library, and the engineer is emailed the transmittal (comments + outcome) with a direct link to it.'
                : 'The transmittal PDF will be attached to the email. The vendor will be informed that marked-up documents are available in their SharePoint portal as of today.'}
            </div>

            {transmittalError && <p className="text-sm text-red-600 mb-3">{transmittalError}</p>}

            <div className="flex gap-3">
              <button
                onClick={handleSendTransmittal}
                disabled={sending || (isInternal && !destLibrary)}
                className="btn-primary flex-1 justify-center flex items-center gap-2"
              >
                {sending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {isInternal ? 'Returning…' : 'Generating & Sending…'}</>
                  : <><Download className="h-4 w-4" /> {isInternal ? 'Return to Engineer' : 'Generate PDF & Send Email'}</>
                }
              </button>
              <button onClick={() => { setShowTransmittalModal(false); setTransmittalError('') }} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline transmittal — preview or sent confirmation */}
      {(transmittalPreview || transmittalSent) && (() => {
        const isSent    = !!transmittalSent
        const docs      = isSent ? transmittalSent.transmittalData?.documents : transmittalPreview?.documents
        const header    = isSent ? transmittalSent.transmittalData : transmittalPreview
        const codeColor = (c: string) =>
          c === 'A1' ? 'bg-green-100 text-emerald-800' : c === 'D1' ? 'bg-blue-100 text-teal-800' :
          c === 'B1' ? 'bg-amber-100 text-amber-800' : c === 'B2' ? 'bg-amber-100 text-amber-800' :
          'bg-red-100 text-red-800'
        return (
          <div ref={transmittalRef} className="card">
            {/* A sent transmittal whose file delivery failed or was partial is NOT a success —
                say so on the confirmation itself, not only in the audit log. */}
            {isSent && transmittalSent?.vendorReturn && !transmittalSent.vendorReturn.ok && (
              <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-800">
                <b>Files not delivered:</b> the transmittal email was sent, but only{' '}
                {transmittalSent.vendorReturn.copied}/{transmittalSent.vendorReturn.total} file(s) reached the
                vendor&apos;s bucket.{' '}
                {transmittalSent.vendorReturn.errors?.[0] ?? ''} Use &ldquo;Retry delivery&rdquo; at the top of this page.
              </div>
            )}
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isSent ? 'bg-teal-100' : 'bg-blue-100'}`}>
                  {isSent ? <Download className="h-4 w-4 text-teal-700" /> : <FileText className="h-4 w-4 text-teal-700" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900">
                      {isSent ? transmittalSent.transmittalNumber : 'Transmittal Preview'}
                    </p>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${codeColor(header?.overallCode)}`}>
                      {header?.overallCode}
                    </span>
                    {isSent
                      ? <span className="text-xs text-slate-400">Sent to {transmittalSent.toEmail} · {transmittalSent.transmittalDate}</span>
                      : <span className="text-xs text-slate-400">{header?.vendorName} · {header?.packageCode}</span>
                    }
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!isSent && (
                  <button onClick={openSendModal} className="btn-primary text-sm flex items-center gap-2">
                    <Download className="h-4 w-4" /> Convert to PDF &amp; Send
                  </button>
                )}
                <button onClick={() => { setTransmittalPreview(null); setTransmittalSent(null) }} className="text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Document list */}
            <div className="px-6 py-4 space-y-3">
              {(!docs || docs.length === 0) && (
                <p className="text-sm text-slate-400 py-4 text-center">No documents found — check that reviews have been submitted for this batch.</p>
              )}
              {(docs ?? []).map((doc: any, i: number) => (
                <div key={i} className="border border-slate-100 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-semibold text-slate-800 block truncate">{doc.fileName}</span>
                      {doc.docName && doc.docName !== doc.fileName && (
                        <span className="text-xs text-slate-500">{doc.docName}</span>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold shrink-0 ${codeColor(doc.outcomeCode)}`}>
                      {doc.outcomeCode}
                    </span>
                  </div>
                  <div className="px-4 py-2 divide-y divide-slate-50">
                    {doc.reviewers?.map((r: any, j: number) => (
                      <div key={j} className="py-1.5 flex items-start gap-3 text-sm">
                        <span className="font-medium text-slate-700 w-28 shrink-0">{r.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold shrink-0 ${codeColor(r.code)}`}>{r.code}</span>
                        <span className="text-slate-500 text-xs">{r.comment || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Re-send option after sent */}
            {isSent && (
              <div className="px-6 pb-4">
                <button onClick={() => { setTransmittalSent(null); setTransmittalPreview(transmittalSent.transmittalData) }} className="btn-secondary text-sm flex items-center gap-2">
                  <Download className="h-3.5 w-3.5" /> Re-send Transmittal
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* Review sequence */}
      {reviewTasks.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Review Sequence</h2>
            <span className="ml-auto text-xs text-slate-400">{reviewTasks.length} task{reviewTasks.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-slate-50">
            {reviewTasks.map((task: any) => (
              <div key={task.id}>
                <div className="px-6 py-3 flex items-center gap-4">
                  <div className="w-7 h-7 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-bold text-xs shrink-0">
                    {task.sequence_number}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-900">{reviewerDisplayName(task.reviewer_email)}</p>
                    <p className="text-xs text-slate-400">{task.reviewer_email}</p>
                    {task.comment && <p className="text-xs text-slate-500 mt-0.5 italic">"{task.comment}"</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {task.review_outcome_code && (
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(task.review_outcome_code as ReviewOutcomeCode)}`}>
                        {task.review_outcome_code}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      task.status === 'completed'   ? 'bg-green-100 text-emerald-700' :
                      task.status === 'sent'        ? 'bg-blue-100 text-teal-700' :
                      task.status === 'in_progress' ? 'bg-amber-100 text-amber-700' :
                      task.status === 'overdue'     ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {task.status}
                    </span>
                    {batch?.viewer_can_amend && task.status === 'completed' && (
                      <button
                        onClick={() => amendTaskId === task.id ? setAmendTaskId(null) : openAmend(task)}
                        title="Amend this outcome"
                        className="flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                      >
                        <PenLine className="h-3.5 w-3.5" /> Amend
                      </button>
                    )}
                  </div>
                </div>

                {amendTaskId === task.id && (
                  <div className="px-6 pb-4 pt-1 bg-amber-50/40 border-t border-amber-100">
                    <p className="text-xs font-semibold text-amber-900 mb-2">
                      Amend {reviewerDisplayName(task.reviewer_email)}'s outcome
                      <span className="font-normal text-amber-700"> — currently {task.review_outcome_code ?? '—'}. This recomputes the batch outcome and is logged.</span>
                    </p>
                    <div className="flex flex-wrap items-start gap-2">
                      <select
                        value={amendCode}
                        onChange={(e) => setAmendCode(e.target.value)}
                        className="rounded-lg border border-amber-300 bg-white py-1.5 pl-2.5 pr-8 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      >
                        <option value="">Select outcome…</option>
                        {Object.values(OUTCOME_CODES).map((o) => (
                          <option key={o.code} value={o.code}>{o.code} — {o.text}</option>
                        ))}
                      </select>
                      <input
                        value={amendReason}
                        onChange={(e) => setAmendReason(e.target.value)}
                        placeholder="Reason (e.g. reviewer confirmed A1 not B2 by email)"
                        className="min-w-[240px] flex-1 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                      <button
                        onClick={() => saveAmend(task.id)}
                        disabled={amendSaving}
                        className="shrink-0 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        {amendSaving ? 'Saving…' : 'Save amendment'}
                      </button>
                      <button
                        onClick={() => setAmendTaskId(null)}
                        className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {amendMsg && amendTaskId === task.id && (
                      <p className={`mt-2 text-xs ${amendMsg.type === 'err' ? 'text-rose-600' : 'text-emerald-700'}`}>{amendMsg.text}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {amendMsg && amendTaskId === null && (
              <div className="px-6 py-3">
                <p className={`text-xs ${amendMsg.type === 'err' ? 'text-rose-600' : 'text-emerald-700'}`}>{amendMsg.text}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
