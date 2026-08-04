'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, PenLine, XCircle, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'

export default function SignoffPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params)
  const router = useRouter()
  const [ctx, setCtx] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<'signed' | 'declined' | null>(null)
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  useEffect(() => { load() }, [taskId])
  async function load() {
    setLoading(true)
    const res = await fetch(`/api/signoff/${taskId}`)
    if (res.ok) setCtx(await res.json())
    setLoading(false)
  }

  async function handleSign() {
    setSigning(true); setError('')
    try {
      const res = await fetch(`/api/signoff/${taskId}/sign`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to sign'); return }
      setDone('signed')
    } catch (e: any) { setError(e.message ?? 'Unexpected error') } finally { setSigning(false) }
  }

  async function handleDecline() {
    if (!declineReason.trim()) { setError('Please give a reason.'); return }
    setSigning(true); setError('')
    try {
      const res = await fetch(`/api/signoff/${taskId}/decline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: declineReason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setDone('declined')
    } catch (e: any) { setError(e.message ?? 'Unexpected error') } finally { setSigning(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-700" /></div>
  if (!ctx?.task) return <div className="card p-8 text-center text-slate-400">Sign-off task not found.</div>

  const { task, batch, canSign, isMine, hasSignature, waitingOn } = ctx

  if (done) return (
    <div className="max-w-lg mx-auto card p-8 text-center space-y-3">
      <CheckCircle2 className={`h-10 w-10 mx-auto ${done === 'signed' ? 'text-emerald-500' : 'text-red-500'}`} />
      <h1 className="text-lg font-bold text-slate-900">{done === 'signed' ? 'Signed — thank you' : 'Declined'}</h1>
      <p className="text-sm text-slate-500">{done === 'signed' ? 'Your signature has been applied and the next signatory (if any) has been notified.' : 'The document controller has been notified to correct and re-send it.'}</p>
      <Link href="/signoffs" className="btn-primary inline-flex mt-2">Back to my sign-offs</Link>
    </div>
  )

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/signoffs" className="btn-secondary text-xs py-1.5 px-3 w-fit"><ArrowLeft className="h-3.5 w-3.5" /> My Sign-offs</Link>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-1">
          <PenLine className="h-5 w-5 text-teal-600" />
          <h1 className="text-lg font-bold text-slate-900">{batch?.title ?? 'Document'}</h1>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
          {batch?.internal_ref && <span><span className="font-medium text-slate-700">Ref:</span> {batch.internal_ref}</span>}
          {task.role_label && <span><span className="font-medium text-slate-700">Signing as:</span> {task.role_label}</span>}
          <span><span className="font-medium text-slate-700">Position:</span> {task.sequence_number}</span>
        </div>
      </div>

      {/* PDF viewer */}
      <div className="card overflow-hidden">
        <iframe src={`/api/signoff/${taskId}/file`} className="w-full" style={{ height: '70vh' }} title="Sign-off document" />
      </div>

      {!hasSignature && isMine && (
        <div className="card p-3 bg-amber-50 border-amber-200 text-sm text-amber-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>You have no saved signature — your typed name will be used. Set up a signature in your <a className="underline" href="https://coreflow.build/settings/signature" target="_blank" rel="noopener noreferrer">Coreflow profile</a> for a proper signature image.</span>
        </div>
      )}

      {error && <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-700">{error}</div>}

      {canSign ? (
        !showDecline ? (
          <div className="flex gap-3">
            <button onClick={handleSign} disabled={signing} className="btn-primary flex-1 justify-center py-3 text-base">
              {signing ? <><Loader2 className="h-5 w-5 animate-spin" /> Signing…</> : <><PenLine className="h-5 w-5" /> Apply my signature</>}
            </button>
            <button onClick={() => setShowDecline(true)} disabled={signing} className="btn-danger justify-center px-5"><XCircle className="h-4 w-4" /> Decline</button>
          </div>
        ) : (
          <div className="card p-4 space-y-2">
            <label className="label">Reason for declining <span className="text-red-500">*</span></label>
            <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3} className="input resize-none" placeholder="e.g. Section 3 still references the old revision — please correct before sign-off." />
            <div className="flex gap-3">
              <button onClick={handleDecline} disabled={signing} className="btn-danger flex-1 justify-center">{signing ? 'Submitting…' : 'Confirm decline'}</button>
              <button onClick={() => { setShowDecline(false); setError('') }} className="btn-secondary justify-center px-5">Back</button>
            </div>
          </div>
        )
      ) : (
        <div className="card p-4 text-sm text-slate-500 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {!isMine ? 'This signature is assigned to someone else.'
            : waitingOn ? 'Waiting for an earlier signatory to sign first — you\'ll be emailed when it\'s your turn.'
            : task.status === 'signed' ? 'You have already signed this document.'
            : 'This document is no longer awaiting your signature.'}
          {batch?.id && <Link href={`/batches/${batch.id}`} className="ml-auto btn-secondary text-xs py-1 px-2.5"><ExternalLink className="h-3.5 w-3.5" /> Batch</Link>}
        </div>
      )}
    </div>
  )
}
