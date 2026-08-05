'use client'

import { useState } from 'react'
import SubmitDrawing from './submit-drawing'

/**
 * The "already submitted" state for a request line. Shows the green confirmation, and —
 * when the engineer needs to book a newer revision (e.g. one came back from Aconex) —
 * reveals the SubmitDrawing form in new-revision mode, which re-cycles the SAME document
 * through review + sign-off. Only offered when the user may submit internal drawings.
 */
export default function SubmittedLine({ lineId, rdmc, revision, packageId, canSubmit }: {
  lineId: string
  rdmc: string
  revision: string | null
  packageId?: string | null
  canSubmit: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        <span>✅ Drawing submitted for review — it&apos;s now an internal batch in <a className="font-medium underline" href="/batches">Incoming Batches</a>.</span>
        {canSubmit && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
          >
            {open ? 'Cancel' : '+ New revision'}
          </button>
        )}
      </div>
      {open && <SubmitDrawing lineId={lineId} rdmc={rdmc} revision={revision} packageId={packageId} mode="newRevision" />}
    </div>
  )
}
