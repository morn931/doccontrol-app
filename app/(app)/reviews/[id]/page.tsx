'use client'
import { useState, useEffect, use } from 'react'
import { ArrowLeft, ExternalLink, Send, AlertTriangle, Save, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

const OUTCOME_CODES = [
  { code: 'A1', label: 'Data Complete — No Comments — Do Not Resubmit',          color: 'border-green-500  bg-green-50  text-green-800'  },
  { code: 'D1', label: 'Received for Info Only — No Comment — Do Not Resubmit',  color: 'border-blue-500   bg-blue-50   text-blue-800'   },
  { code: 'B1', label: 'Data Complete — With Comments — Proceed — Resubmit',     color: 'border-yellow-500 bg-yellow-50 text-yellow-800' },
  { code: 'B2', label: 'Data Incomplete — With Comments — Proceed — Resubmit',   color: 'border-orange-500 bg-orange-50 text-orange-800' },
  { code: 'C1', label: 'Data Incomplete — With Comments — Hold Work — Resubmit', color: 'border-red-500    bg-red-50    text-red-800'    },
  { code: 'Q1', label: 'Quality is below Standard — Revise and Resubmit',         color: 'border-red-700    bg-red-100   text-red-900'    },
  { code: 'V1', label: 'Cancelled',                                               color: 'border-gray-400   bg-gray-50   text-gray-600'  },
  { code: 'S1', label: 'Superseded',                                              color: 'border-gray-400   bg-gray-50   text-gray-600'  },
]

export default function ReviewWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [task, setTask]         = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [outcome, setOutcome]   = useState('')
  const [comment, setComment]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [error, setError]       = useState('')
  const [showNMR, setShowNMR]   = useState(false)
  const [nmrReason, setNmrReason] = useState('')

  useEffect(() => {
    loadTask()
  }, [id])

  async function loadTask() {
    setLoading(true)
    const res = await fetch(`/api/reviews/${id}`)
    if (res.ok) {
      const data = await res.json()
      setTask(data)
      // Pre-fill draft if exists
      if (data.comment) setComment(data.comment)
      if (data.review_outcome_code) setOutcome(data.review_outcome_code)
      // Mark as opened
      if (data.status === 'sent' || data.status === 'pending') {
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
    else { setSubmitted(true) }
    setSubmitting(false)
  }

  async function handleNeedMoreReview() {
    setError(''); setSubmitting(true)
    const res = await fetch(`/api/reviews/${id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ needMoreReview: true, comment: nmrReason || comment }),
    })
    if (res.ok) setSubmitted(true)
    else { const d = await res.json(); setError(d.error ?? 'Failed'); setSubmitting(false) }
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

  if (!task) return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/reviews" className="btn-secondary text-xs py-1.5 px-3"><ArrowLeft className="h-3.5 w-3.5" /> My Reviews</Link>
      <div className="card p-8 text-center text-gray-400">Review task not found or you are not assigned to this review.</div>
    </div>
  )

  const dv    = task.document_versions ?? {}
  const batch = dv.batches ?? {}
  const isCompleted = task.status === 'completed' || submitted
  const isActive = ['sent','opened','in_progress','pending'].includes(task.status)
  const canSubmit = isActive && !submitted

  if (submitted) return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/reviews" className="btn-secondary text-xs py-1.5 px-3"><ArrowLeft className="h-3.5 w-3.5" /> My Reviews</Link>
      <div className="card p-10 text-center">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Review Submitted</h2>
        <p className="text-gray-500 mb-1">Outcome: <strong>{outcome || 'Needs More Review'}</strong></p>
        <p className="text-gray-400 text-sm">The next reviewer has been notified automatically.</p>
        <Link href="/reviews" className="btn-primary mt-6 inline-flex">Back to My Reviews</Link>
      </div>
    </div>
  )

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/reviews" className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> My Reviews
        </Link>
      </div>

      {/* Header */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-mono text-sm font-semibold text-gray-900">{dv.file_name}</span>
              {dv.revision && <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">Rev {dv.revision}</span>}
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
            {dv.doc_name && <p className="text-gray-700 font-medium">{dv.doc_name}</p>}
            <div className="flex flex-wrap gap-x-4 text-sm text-gray-500 mt-1">
              {batch.packages?.package_name && <span>{batch.packages.package_name}</span>}
              {dv.discipline    && <span>· {dv.discipline}</span>}
              {dv.document_type && <span>· {dv.document_type}</span>}
              <span>· Reviewer {task.sequence_number}</span>
              {task.due_date && <span className={`· Due ${format(new Date(task.due_date), 'd MMM yyyy')} ${new Date(task.due_date) < new Date() ? '⚠️' : ''}`} />}
            </div>
          </div>
          {dv.central_file_url && (
            <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer"
              className="btn-primary shrink-0">
              <ExternalLink className="h-4 w-4" /> Open Document
            </a>
          )}
        </div>

        {/* AI Summary */}
        {dv.ai_text && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-md text-sm text-blue-800">
            <p className="font-semibold mb-1">AI Summary</p>
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{dv.ai_text}</pre>
          </div>
        )}
      </div>

      {/* Review form */}
      {canSubmit && (
        <>
          {/* Outcome selection */}
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Select Review Outcome <span className="text-red-500">*</span></h2>
            <div className="space-y-2">
              {OUTCOME_CODES.map(oc => (
                <label key={oc.code}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    outcome === oc.code ? oc.color + ' border-2' : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}>
                  <input type="radio" name="outcome" value={oc.code}
                    checked={outcome === oc.code} onChange={() => setOutcome(oc.code)} className="shrink-0" />
                  <span className="font-bold text-sm w-8 shrink-0">{oc.code}</span>
                  <span className="text-sm">{oc.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">Review Comments</h2>
              <button onClick={saveDraft} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                <Save className="h-3.5 w-3.5" /> Save Draft
              </button>
            </div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={5}
              className="input resize-none"
              placeholder="Add your technical review comments, markups, or concerns here…"
            />
          </div>

          {error && <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={handleSubmit} disabled={submitting || !outcome}
              className="btn-primary flex-1 justify-center py-3 text-base">
              <Send className="h-5 w-5" />
              {submitting ? 'Submitting…' : 'Submit Review — Send to Next Reviewer'}
            </button>
          </div>

          {/* Need More Review */}
          <div className="card p-4">
            <button onClick={() => setShowNMR(!showNMR)}
              className="flex items-center gap-2 text-sm text-amber-700 font-medium hover:text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              Need More Review — Request additional reviewer
            </button>
            {showNMR && (
              <div className="mt-3 space-y-3">
                <textarea value={nmrReason} onChange={e => setNmrReason(e.target.value)}
                  rows={3} className="input resize-none"
                  placeholder="Explain why additional review is needed…" />
                <button onClick={handleNeedMoreReview} disabled={submitting}
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
      {isCompleted && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Your Review (Submitted)</h2>
          {task.review_outcome_code && (
            <div className="flex items-center gap-3">
              <span className="font-bold text-lg text-gray-900">{task.review_outcome_code}</span>
              <span className="text-gray-600 text-sm">{OUTCOME_CODES.find(o => o.code === task.review_outcome_code)?.label}</span>
            </div>
          )}
          {task.comment && <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-md">{task.comment}</p>}
          {task.date_completed && <p className="text-xs text-gray-400">Submitted {format(new Date(task.date_completed), 'd MMM yyyy HH:mm')}</p>}
        </div>
      )}
    </div>
  )
}
