'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { returnBooking } from '../actions'

/**
 * "Return this number" — un-books a placeholder booked from the Number Picker, freeing it
 * back into the picker. Only rendered while the number is still reversible (no drawing
 * submitted for review yet); the server action enforces the same rule.
 */
export default function ReturnBooking({ requestId, docno }: { requestId: string; docno: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const doReturn = () => {
    setErr(null)
    start(async () => {
      const r = await returnBooking(requestId)
      if (r.ok) router.push('/documents/requests')
      else { setErr(r.error ?? 'Could not return the number.'); setConfirming(false) }
    })
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span>
        Booked from an existing placeholder. Made a mistake or no longer need <b className="font-mono">{docno}</b>? You can return it — until you submit a drawing for review.
      </span>
      {confirming ? (
        <span className="flex items-center gap-2">
          <span className="text-xs">Return it and free the number?</span>
          <button onClick={doReturn} disabled={busy}
            className="rounded-lg bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50">
            {busy ? 'Returning…' : 'Yes, return'}
          </button>
          <button onClick={() => setConfirming(false)} disabled={busy}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
            Cancel
          </button>
        </span>
      ) : (
        <button onClick={() => setConfirming(true)}
          className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100">
          Return this number
        </button>
      )}
      {err && <span className="w-full text-xs text-red-600">{err}</span>}
    </div>
  )
}
