'use client'
import { useState, useEffect, use } from 'react'
import {
  ArrowLeft, ExternalLink, Send, AlertTriangle, Save, CheckCircle,
  ChevronDown, ChevronUp, Users, History, FileText, Plus, X
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

const OUTCOME_CODES = [
  { code: 'A1', label: 'Data Complete — No Comments — Do Not Resubmit',          color: 'border-green-500  bg-green-50  text-green-800'  },
  { code: 'D1', label: 'Received for Info Only — No Comment — Do Not Resubmit',  color: 'border-blue-500   bg-blue-50   text-blue-800'   },
  { code: 'B1', label: 'Data Complete — With Comments — Proceed — Resubmit',     color: 'border-yellow-500 bg-yellow-50 text-yellow-800' },
  { code: 'B2', label: 'Data Incomplete — With Comments — Proceed — Resubmit',   color: 'border-orange-500 bg-orange-50 text-orange-800' },
  { code: 'C1', label: 'Data Incomplete — With Comments — Hold Work — Resubmit', color: 'border-red-500    bg-red-50    text-red-800'    },
  { code: 'Q1', label: 'Quality is below Standard — Revise and Resubmit',         color: 'border-red-700    bg-red-100   text-red-900'    },
  { code: 'V1', label: 'Cancelled',                                               color: 'border-slate-400   bg-slate-50   text-slate-600'  },
  { code: 'S1', label: 'Superseded',                                              color: 'border-slate-400   bg-slate-50   text-slate-600'  },
]

const OUTCOME_COLORS: Record<string, string> = {
  A1:'bg-green-100 text-green-700', D1:'bg-blue-100 text-blue-700',
  B1:'bg-yellow-100 text-yellow-700', B2:'bg-orange-100 text-orange-700',
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
  const [newReviewerReason, setNewReviewerReason] = useState('')
  const [addingReviewer, setAddingReviewer] = useState(false)

  useEffect(() => { loadContext() }, [id])

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
        reviewerName: reviewerName(newReviewerEmail.trim()),
        insertAfterSequence: ctx.task.sequence_number,
        reason: newReviewerReason,
      }),
    })
    if (res.ok) {
      setShowAddReviewer(false); setNewReviewerEmail(''); setNewReviewerReason('')
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
  const batch = dv.batches ?? {}
  const isCompleted = task.status === 'completed' || submitted
  const canSubmit   = ['sent','opened','in_progress','pending'].includes(task.status) && !submitted

  // Previous reviewers who already completed (visible to current reviewer)
  const completedBefore = docChain.filter((t: any) =>
    t.sequence_number < task.sequence_number && t.status === 'completed'
  )
  // Pending/future reviewers
  const futureReviewers = docChain.filter((t: any) =>
    t.sequence_number > task.sequence_number
  )

  if (submitted) return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/reviews" className="btn-secondary text-xs py-1.5 px-3"><ArrowLeft className="h-3.5 w-3.5" /> My Reviews</Link>
      <div className="card p-10 text-center">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Review Submitted</h2>
        <p className="text-slate-500 mb-1">Outcome: <strong>{outcome || 'Escalated for more review'}</strong></p>
        <p className="text-slate-400 text-sm">
          {isLastReviewer ? 'You were the final reviewer. The document controller has been notified.' : 'The next reviewer has been notified automatically.'}
        </p>
        <Link href="/reviews" className="btn-primary mt-6 inline-flex">Back to My Reviews</Link>
      </div>
    </div>
  )

  return (
    <div className="space-y-4 max-w-4xl">
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
                    ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
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
                isCompleted ? 'bg-green-100 text-green-700' :
                task.status === 'overdue' ? 'bg-red-100 text-red-700' :
                'bg-orange-100 text-orange-700'
              }`}>
                {isCompleted ? 'Completed' : task.status}
              </span>
              {task.is_manager_override && (
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">Manager Override</span>
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
              <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer"
                className="btn-primary">
                <ExternalLink className="h-4 w-4" /> Open Document
              </a>
            ) : (
              <div className="text-xs text-slate-400 max-w-[160px] text-right">
                Document URL not yet available — check back shortly after the file has been processed.
              </div>
            )}
          </div>
        </div>

        {/* AI Summary */}
        {dv.ai_text && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-md text-sm text-blue-800">
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
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{completedBefore.length} completed</span>
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
                return (
                  <div key={t.id} className={`px-5 py-3 flex items-start gap-3 ${isCurrent ? 'bg-navy-50' : ''}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      isDone ? 'bg-green-500 text-white' :
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
                        {t.review_outcome_code && (
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${OUTCOME_COLORS[t.review_outcome_code] ?? 'bg-slate-100 text-slate-600'}`}>
                            {t.review_outcome_code}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          isDone ? 'bg-green-100 text-green-600' :
                          t.status === 'sent' ? 'bg-blue-100 text-blue-600' :
                          isCurrent ? 'bg-orange-100 text-orange-600' :
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

            {/* Add reviewer button */}
            {canSubmit && (
              <div className="px-5 py-3 border-t border-slate-100">
                {!showAddReviewer ? (
                  <button onClick={() => setShowAddReviewer(true)}
                    className="flex items-center gap-2 text-sm text-navy-600 hover:text-navy-800 font-medium">
                    <Plus className="h-4 w-4" /> Add another reviewer to this batch
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">Add reviewer after your position ({task.sequence_number}):</p>
                    <input value={newReviewerEmail} onChange={e => setNewReviewerEmail(e.target.value)}
                      placeholder="reviewer@ppetech.co.za" className="input text-sm" />
                    <input value={newReviewerReason} onChange={e => setNewReviewerReason(e.target.value)}
                      placeholder="Reason for adding reviewer (optional)" className="input text-sm" />
                    <div className="flex gap-2">
                      <button onClick={handleAddReviewer} disabled={addingReviewer || !newReviewerEmail.trim()}
                        className="btn-primary text-xs py-1.5">
                        {addingReviewer ? 'Adding…' : 'Add Reviewer'}
                      </button>
                      <button onClick={() => { setShowAddReviewer(false); setNewReviewerEmail(''); setNewReviewerReason('') }}
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

      {/* ── REVIEW FORM ──────────────────────────────────────────────────────── */}
      {canSubmit && (
        <>
          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-3">
              Select Review Outcome <span className="text-red-500">*</span>
            </h2>
            <div className="space-y-2">
              {OUTCOME_CODES.map(oc => (
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
                {OUTCOME_CODES.find(o => o.code === task.review_outcome_code)?.label}
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
