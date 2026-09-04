'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowUp, ArrowDown, ArrowRight, Move, PenLine, XCircle, Loader2, CheckCircle2, AlertCircle, ExternalLink, Undo2 } from 'lucide-react'

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
  const [pdfV, setPdfV] = useState(0)          // cache-buster to re-render the iframe after a move
  const [moving, setMoving] = useState(false)
  const [step, setStep] = useState(12)         // nudge distance in PDF points
  const [nudgeTarget, setNudgeTarget] = useState<'signature' | 'date'>('signature')
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)

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
      await load(); setPdfV(v => v + 1); setDone('signed')
    } catch (e: any) { setError(e.message ?? 'Unexpected error') } finally { setSigning(false) }
  }

  // Move a signed signature. PDF y increases UPWARD, so ↑ = +dy. Re-stamps server-side and
  // cache-busts the viewer so the change shows immediately.
  async function nudge(dx: number, dy: number) {
    setMoving(true); setError('')
    try {
      const res = await fetch(`/api/signoff/${taskId}/place`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dx, dy, target: nudgeTarget }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? `Could not move the ${nudgeTarget}.`); return }
      setPdfV(v => v + 1)
    } catch (e: any) { setError(e.message ?? 'Could not move the signature.') } finally { setMoving(false) }
  }

  // Take my own signature back off. The PDF is rebuilt from the clean base without it, and the
  // task returns to me to sign again or decline — so this is a real undo, not a new revision.
  async function handleWithdraw() {
    setWithdrawing(true); setError('')
    try {
      const res = await fetch(`/api/signoff/${taskId}/withdraw`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: withdrawReason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not remove your signature.'); return }
      setShowWithdraw(false); setWithdrawReason(''); setDone(null)
      await load(); setPdfV(v => v + 1)
    } catch (e: any) { setError(e.message ?? 'Unexpected error') } finally { setWithdrawing(false) }
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

  const { task, batch, canSign, isMine, hasSignature, waitingOn, canWithdraw, withdrawBlockedBy, signatureImage } = ctx

  // Transparent squares show through the chequer; a scanned signature that still has its
  // paper shows as a solid block — which is exactly what would land on the drawing.
  const CHEQUER = {
    backgroundImage:
      'linear-gradient(45deg,#eef2f6 25%,transparent 25%),linear-gradient(-45deg,#eef2f6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eef2f6 75%),linear-gradient(-45deg,transparent 75%,#eef2f6 75%)',
    backgroundSize: '12px 12px',
    backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
  } as const

  if (done) return (
    <div className="max-w-lg mx-auto card p-8 text-center space-y-3">
      <CheckCircle2 className={`h-10 w-10 mx-auto ${done === 'signed' ? 'text-emerald-500' : 'text-red-500'}`} />
      <h1 className="text-lg font-bold text-slate-900">{done === 'signed' ? 'Signed — thank you' : 'Declined'}</h1>
      <p className="text-sm text-slate-500">{done === 'signed' ? 'Your signature has been applied and the next signatory (if any) has been notified.' : 'The document controller has been notified to correct and re-send it.'}</p>
      <div className="flex flex-wrap gap-2 justify-center pt-1">
        {done === 'signed' && <button onClick={() => setDone(null)} className="btn-secondary inline-flex"><Move className="h-4 w-4" /> Adjust signature position</button>}
        {/* The moment someone most wants to undo a signature is right after applying it —
            seeing it on the page for the first time. Don't make them hunt for the way back. */}
        {done === 'signed' && canWithdraw && (
          <button onClick={() => { setDone(null); setShowWithdraw(true) }} className="btn-secondary inline-flex"><Undo2 className="h-4 w-4" /> Undo my signature</button>
        )}
        <Link href="/signoffs" className="btn-primary inline-flex">Back to my sign-offs</Link>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
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

      {/* PDF fills the width; the sign-off actions sit in a column beside it on wide screens. */}
      <div className="flex flex-col xl:flex-row gap-4 items-start">
        <div className="card overflow-hidden flex-1 min-w-0 w-full">
          <iframe src={`/api/signoff/${taskId}/file?v=${pdfV}`} className="w-full" style={{ height: '84vh' }} title="Sign-off document" />
        </div>

        <div className="w-full xl:w-[380px] shrink-0 space-y-4">
          {error && <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-700">{error}</div>}

          {!hasSignature && isMine && (
            <div className="card p-3 bg-amber-50 border-amber-200 text-sm text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>You have no saved signature — your typed name will be used. Set up a signature in your <a className="underline" href="https://coreflow.build/signature" target="_blank" rel="noopener noreferrer">Coreflow profile</a> for a proper signature image.</span>
            </div>
          )}

          {/* What is actually going to be stamped, before it is stamped. */}
          {isMine && canSign && signatureImage && (
            <div className="card p-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">This is what will be stamped</div>
              <div className="flex min-h-[56px] items-center justify-center rounded-lg px-2" style={CHEQUER}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={signatureImage} alt="Your signature" className="max-h-20 object-contain" />
              </div>
              <p className="text-[11px] text-slate-400">
                The chequered squares are see-through. If your signature sits on a solid block, that
                block gets stamped onto the drawing too —{' '}
                <a className="underline" href="https://coreflow.build/signature" target="_blank" rel="noopener noreferrer">clear it in your Coreflow profile</a>{' '}
                before signing.
              </p>
            </div>
          )}

          {canSign ? (
            !showDecline ? (
              <div className="card p-4 space-y-3">
                <button onClick={handleSign} disabled={signing} className="btn-primary w-full justify-center py-3 text-base">
                  {signing ? <><Loader2 className="h-5 w-5 animate-spin" /> Signing…</> : <><PenLine className="h-5 w-5" /> Apply my signature</>}
                </button>
                <button onClick={() => setShowDecline(true)} disabled={signing} className="btn-danger w-full justify-center"><XCircle className="h-4 w-4" /> Decline</button>
              </div>
            ) : (
              <div className="card p-4 space-y-2">
                <label className="label">Reason for declining <span className="text-red-500">*</span></label>
                <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={4} className="input resize-none" placeholder="e.g. Section 3 still references the old revision — please correct before sign-off." />
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

          {isMine && task.status === 'signed' && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Move className="h-4 w-4 text-teal-600" /> Move my signature</div>
              <p className="text-xs text-slate-500">Your signature and date are placed automatically in the sign-off block. If either needs adjusting, pick which one below and nudge it — the document updates each time you move it.</p>
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-max text-xs font-medium">
                <button onClick={() => setNudgeTarget('signature')} className={`px-3 py-1 rounded-md ${nudgeTarget === 'signature' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>Signature</button>
                <button onClick={() => setNudgeTarget('date')} className={`px-3 py-1 rounded-md ${nudgeTarget === 'date' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>Date</button>
              </div>
              <div className="flex items-center gap-6">
                <div className="grid grid-cols-3 gap-1 w-max">
                  <span />
                  <button onClick={() => nudge(0, step)} disabled={moving} className="btn-secondary p-2 justify-center"><ArrowUp className="h-4 w-4" /></button>
                  <span />
                  <button onClick={() => nudge(-step, 0)} disabled={moving} className="btn-secondary p-2 justify-center"><ArrowLeft className="h-4 w-4" /></button>
                  <span />
                  <button onClick={() => nudge(step, 0)} disabled={moving} className="btn-secondary p-2 justify-center"><ArrowRight className="h-4 w-4" /></button>
                  <span />
                  <button onClick={() => nudge(0, -step)} disabled={moving} className="btn-secondary p-2 justify-center"><ArrowDown className="h-4 w-4" /></button>
                  <span />
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  <label className="block font-medium">Step size</label>
                  <select value={step} onChange={e => setStep(Number(e.target.value))} className="input py-1 text-xs">
                    <option value={6}>Fine (6 pt)</option>
                    <option value={12}>Medium (12 pt)</option>
                    <option value={36}>Coarse (36 pt)</option>
                  </select>
                  {moving && <span className="flex items-center gap-1 text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> updating…</span>}
                </div>
              </div>
            </div>
          )}

          {/* Undo. The signed PDF is rebuilt from the clean base every time, so removing a
              signature is simply not stamping it — nothing is scraped off a finished file. */}
          {isMine && task.status === 'signed' && (canWithdraw || withdrawBlockedBy) && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Undo2 className="h-4 w-4 text-slate-500" /> Undo my signature</div>
              {canWithdraw ? (
                !showWithdraw ? (
                  <>
                    <p className="text-xs text-slate-500">Signed the wrong document, or need to change something first? Take your signature back off — it comes out of the document cleanly and this goes back to you to sign again when you&apos;re ready.</p>
                    <button onClick={() => setShowWithdraw(true)} className="btn-secondary w-full justify-center"><Undo2 className="h-4 w-4" /> Remove my signature</button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">Your signature will be taken off the document and this returns to you unsigned. Anyone waiting behind you is put back on hold and told to wait.</p>
                    <label className="label">Reason <span className="font-normal text-slate-400">(optional — for the record)</span></label>
                    <textarea value={withdrawReason} onChange={e => setWithdrawReason(e.target.value)} rows={3} className="input resize-none" placeholder="e.g. signed before the revision was updated" />
                    <div className="flex gap-3">
                      <button onClick={handleWithdraw} disabled={withdrawing} className="btn-danger flex-1 justify-center">{withdrawing ? <><Loader2 className="h-4 w-4 animate-spin" /> Removing…</> : 'Confirm — remove it'}</button>
                      <button onClick={() => { setShowWithdraw(false); setError('') }} className="btn-secondary justify-center px-5">Back</button>
                    </div>
                  </>
                )
              ) : (
                <p className="text-xs text-slate-500">
                  <b className="text-slate-700">{withdrawBlockedBy}</b> already signed after you. Removing your signature now would change a document they have approved, so a document controller has to reset the sign-off for this batch.
                  {batch?.id && <Link href={`/batches/${batch.id}`} className="ml-1 underline">Open the batch</Link>}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
