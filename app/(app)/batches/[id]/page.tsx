'use client'
import { useState, useEffect, useRef, use } from 'react'
import { ArrowLeft, FileText, Users, ExternalLink, AlertCircle, X, Edit3, Save, XCircle, Download, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'
import { outcomeColorClass } from '@/lib/utils/outcome-codes'
import type { ReviewOutcomeCode } from '@/lib/types/database'

const DISCIPLINES  = ['Electrical','Instrumentation','Automation','Mechanical','Civil','Commercial','Not sure']
const DOC_TYPES    = ['Specification','Drawing','Calculation','Datasheet','RFI','Contract Notice','Change Request','Variation/VO','Delay Notice','Claim','Commercial Letter','Not sure']
const TOPICS       = ['Technical','SHERQ','Contractual','Not sure']

const STATUS_COLORS: Record<string, string> = {
  intake_received:              'bg-blue-100 text-blue-800',
  metadata_pending:             'bg-yellow-100 text-yellow-800',
  ready_for_reviewer_assignment:'bg-indigo-100 text-indigo-800',
  review_ready_to_start:        'bg-purple-100 text-purple-800',
  review_in_progress:           'bg-orange-100 text-orange-800',
  review_complete:              'bg-teal-100 text-teal-800',
  transmittal_generated:        'bg-cyan-100 text-cyan-800',
  returned_to_vendor:           'bg-green-100 text-green-800',
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
  const [editingDv, setEditingDv]       = useState<string | null>(null)
  const [editForm, setEditForm]         = useState<any>({})
  const [saving, setSaving]             = useState(false)
  const transmittalRef = useRef<HTMLDivElement>(null)
  const [transmittalPreview, setTransmittalPreview]       = useState<any>(null)  // inline preview (before send)
  const [transmittalSent, setTransmittalSent]             = useState<any>(null)  // confirmed after send
  const [generatingPreview, setGeneratingPreview]         = useState(false)
  const [showTransmittalModal, setShowTransmittalModal]   = useState(false)
  const [toEmail, setToEmail]                             = useState('')
  const [ccEmails, setCcEmails]                           = useState<string[]>([])
  const [newCc, setNewCc]                                 = useState('')
  const [pastEmails, setPastEmails]                       = useState<string[]>([])
  const [sending, setSending]                             = useState(false)
  const [transmittalError, setTransmittalError]           = useState('')

  useEffect(() => { loadBatch() }, [id])

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

  async function handleReject() {
    if (!rejectReason.trim()) { setRejectError('Please enter a rejection reason'); return }
    setRejecting(true); setRejectError('')
    const res = await fetch(`/api/batches/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectReason }),
    })
    const data = await res.json()
    if (!res.ok) { setRejectError(data.error ?? 'Failed'); setRejecting(false) }
    else { setShowReject(false); setRejectReason(''); loadBatch() }
    setRejecting(false)
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
      if (!ccEmails.length && data.defaultCc) setCcEmails([data.defaultCc])
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

  async function handleSendTransmittal() {
    if (!toEmail.trim()) { setTransmittalError('Vendor email is required'); return }
    setSending(true); setTransmittalError('')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55_000) // 55s client timeout
    try {
      const res = await fetch(`/api/batches/${id}/generate-transmittal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail: toEmail.trim(), ccEmails: ccEmails.filter(Boolean) }),
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

  async function handleSaveMetadata(dvId: string) {
    setSaving(true)
    const res = await fetch(`/api/documents/${dvId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) { setEditingDv(null); loadBatch() }
    setSaving(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-700" />
    </div>
  )
  if (!batch) return <div className="card p-8 text-center text-slate-400">Batch not found.</div>

  const docVersions = batch.document_versions ?? []
  const statusColor = STATUS_COLORS[batch.status] ?? 'bg-slate-100 text-slate-600'
  const statusLabel = STATUS_LABELS[batch.status] ?? batch.status
  const canReject = ['intake_received','metadata_pending','ready_for_reviewer_assignment'].includes(batch.status)
  const canEdit   = ['intake_received','metadata_pending','ready_for_reviewer_assignment'].includes(batch.status)

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
      {/* Back */}
      <div className="flex items-center gap-3">
        <Link href="/batches" className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Batches
        </Link>
      </div>

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
              {batch.vendor_email && <span><span className="font-medium text-slate-700">Vendor email:</span> {batch.vendor_email}</span>}
            </div>

            {uniqueReviewers.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <span className="text-xs font-medium text-slate-500">Reviewers:</span>
                {uniqueReviewers.map((r, i) => {
                  const allDone  = r.statuses.every(s => s === 'completed')
                  const anyActive = r.statuses.some(s => ['sent','in_progress','opened'].includes(s))
                  return (
                    <span key={r.email} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${allDone ? 'bg-green-100 text-green-700' : anyActive ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
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
              <button onClick={() => setShowReject(true)} className="btn-danger text-sm">
                <XCircle className="h-4 w-4" /> Reject Batch
              </button>
            )}
            {['intake_received','metadata_pending','ready_for_reviewer_assignment'].includes(batch.status) && (
              <Link href={`/batches/${id}/assign`} className="btn-primary text-sm">
                <Users className="h-4 w-4" /> Assign Reviewers
              </Link>
            )}
            {['review_complete','transmittal_generated'].includes(batch.status) && (
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
          </div>
        </div>

        {batch.comments && (
          <div className="mt-4 p-3 bg-blue-50 rounded-md text-sm text-blue-800 border border-blue-100">
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
      </div>

      {/* Transmittal error banner */}
      {transmittalError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{transmittalError}</span>
          <button onClick={() => setTransmittalError('')} className="ml-auto shrink-0"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Reject modal */}
      {showReject && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" /> Reject Batch Before Review
              </h2>
              <button onClick={() => { setShowReject(false); setRejectReason(''); setRejectError('') }}>
                <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              The vendor will be notified by email. Provide a clear reason so they can correct and resubmit.
            </p>
            <label className="label">Rejection Reason <span className="text-red-500">*</span></label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={4}
              className="input resize-none"
              placeholder="e.g. Wrong document type on cover page. Title block does not match SDDR. Please correct and resubmit."
            />
            {rejectError && <p className="text-sm text-red-600 mt-2">{rejectError}</p>}
            <div className="flex gap-3 mt-4">
              <button onClick={handleReject} disabled={rejecting} className="btn-danger flex-1 justify-center">
                {rejecting ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
              <button onClick={() => { setShowReject(false); setRejectReason('') }} className="btn-secondary flex-1 justify-center">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documents */}
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-900">Documents ({docVersions.length})</h2>
          {uniqueReviewers.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-1.5">
              {uniqueReviewers.map((r, i) => {
                const allDone = r.statuses.every(s => s === 'completed')
                const anyActive = r.statuses.some(s => ['sent','in_progress','opened'].includes(s))
                return (
                  <span key={r.email} className={`px-2 py-0.5 rounded-full text-xs font-medium ${allDone ? 'bg-green-100 text-green-700' : anyActive ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`} title={r.email}>
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
              {editingDv === dv.id ? (
                // ── Edit mode ──────────────────────────────────────────────
                <div className="space-y-3">
                  <p className="font-mono text-sm font-semibold text-slate-900">{dv.file_name}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label text-xs">Document Title</label>
                      <input value={editForm.doc_name ?? ''} onChange={e => setEditForm({...editForm, doc_name: e.target.value})} className="input text-sm" />
                    </div>
                    <div>
                      <label className="label text-xs">Discipline</label>
                      <select value={editForm.discipline ?? ''} onChange={e => setEditForm({...editForm, discipline: e.target.value})} className="input text-sm">
                        <option value="">—</option>
                        {DISCIPLINES.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs">Document Type</label>
                      <select value={editForm.document_type ?? ''} onChange={e => setEditForm({...editForm, document_type: e.target.value})} className="input text-sm">
                        <option value="">—</option>
                        {DOC_TYPES.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs">Topic</label>
                      <select value={editForm.topic ?? ''} onChange={e => setEditForm({...editForm, topic: e.target.value})} className="input text-sm">
                        <option value="">—</option>
                        {TOPICS.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  {dv.ai_text && (
                    <div className="p-3 bg-blue-50 rounded text-xs text-blue-700 max-h-32 overflow-auto">
                      <strong>AI Output:</strong><br />
                      <pre className="whitespace-pre-wrap font-sans">{dv.ai_text}</pre>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => handleSaveMetadata(dv.id)} disabled={saving} className="btn-primary text-xs py-1.5">
                      <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingDv(null)} className="btn-secondary text-xs py-1.5">Cancel</button>
                  </div>
                </div>
              ) : (
                // ── View mode ──────────────────────────────────────────────
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-slate-900">{dv.file_name}</span>
                      {dv.revision && <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">Rev {dv.revision}</span>}
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        dv.ai_metadata_source === 'manually_overridden' ? 'bg-purple-100 text-purple-700' :
                        dv.ai_metadata_source === 'manually_confirmed'  ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {dv.ai_metadata_source === 'manually_overridden' ? 'Manual' : dv.ai_metadata_source === 'manually_confirmed' ? 'AI (confirmed)' : 'AI'}
                      </span>
                    </div>
                    {dv.doc_name && dv.doc_name !== dv.file_name && <p className="text-sm text-slate-700 font-medium mt-0.5">{dv.doc_name}</p>}
                    <div className="flex flex-wrap gap-x-3 text-xs text-slate-400 mt-0.5">
                      {dv.discipline    && <span>{dv.discipline}</span>}
                      {dv.document_type && <span>· {dv.document_type}</span>}
                      {dv.topic         && <span>· {dv.topic}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {canEdit && (
                      <button onClick={() => { setEditingDv(dv.id); setEditForm({ doc_name: dv.doc_name, discipline: dv.discipline, document_type: dv.document_type, topic: dv.topic }) }}
                        className="btn-secondary text-xs py-1.5 px-3">
                        <Edit3 className="h-3.5 w-3.5" /> Edit
                      </button>
                    )}
                    {dv.central_file_url && (
                      <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs py-1.5 px-3">
                        <ExternalLink className="h-3.5 w-3.5" /> Open
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Transmittal modal */}
      {showTransmittalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Download className="h-5 w-5 text-blue-600" />
                Send Transmittal — {batch.packages?.package_name ?? ''}
              </h2>
              <button onClick={() => { setShowTransmittalModal(false); setTransmittalError('') }}>
                <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {/* To */}
            <div className="mb-4">
              <label className="label">To (Vendor Email) <span className="text-red-500">*</span></label>
              <input
                list="past-emails"
                type="email"
                value={toEmail}
                onChange={e => setToEmail(e.target.value)}
                className="input"
                placeholder="vendor@company.com"
                autoFocus
              />
              <datalist id="past-emails">
                {pastEmails.map(e => <option key={e} value={e} />)}
              </datalist>
            </div>

            {/* CC */}
            <div className="mb-4">
              <label className="label">CC</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {ccEmails.map((email, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
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
            <div className="mb-5 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
              The transmittal PDF will be attached to the email. The vendor will be informed that
              marked-up documents are available in their SharePoint portal as of today.
            </div>

            {transmittalError && <p className="text-sm text-red-600 mb-3">{transmittalError}</p>}

            <div className="flex gap-3">
              <button
                onClick={handleSendTransmittal}
                disabled={sending}
                className="btn-primary flex-1 justify-center flex items-center gap-2"
              >
                {sending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating &amp; Sending…</>
                  : <><Download className="h-4 w-4" /> Generate PDF &amp; Send Email</>
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
          c === 'A1' ? 'bg-green-100 text-green-800' : c === 'D1' ? 'bg-blue-100 text-blue-800' :
          c === 'B1' ? 'bg-yellow-100 text-yellow-800' : c === 'B2' ? 'bg-orange-100 text-orange-800' :
          'bg-red-100 text-red-800'
        return (
          <div ref={transmittalRef} className="card">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isSent ? 'bg-teal-100' : 'bg-blue-100'}`}>
                  {isSent ? <Download className="h-4 w-4 text-teal-700" /> : <FileText className="h-4 w-4 text-blue-700" />}
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
              <div key={task.id} className="px-6 py-3 flex items-center gap-4">
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
                    task.status === 'completed'   ? 'bg-green-100 text-green-700' :
                    task.status === 'sent'        ? 'bg-blue-100 text-blue-700' :
                    task.status === 'in_progress' ? 'bg-orange-100 text-orange-700' :
                    task.status === 'overdue'     ? 'bg-red-100 text-red-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {task.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
