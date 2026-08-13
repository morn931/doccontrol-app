'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { editAllocatedTitle } from '../actions'

/**
 * Edit the title of an already-allocated line (Document Control). The RDMC number is fixed —
 * only the descriptive title changes. Shown on allocated lines that haven't yet had a drawing
 * submitted against them.
 */
export default function EditTitle({ lineId, rdmc, initial }: {
  lineId: string
  rdmc: string
  initial: { title1: string | null; title2: string | null; title3: string | null; full_title: string | null }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [t1, setT1] = useState(initial.title1 ?? '')
  const [t2, setT2] = useState(initial.title2 ?? '')
  const [t3, setT3] = useState(initial.title3 ?? '')
  const [full, setFull] = useState(initial.full_title ?? [initial.title1, initial.title2, initial.title3].filter(Boolean).join(' - '))

  // While the controller edits the parts, keep the composed full title in step — unless they've
  // hand-tuned it away from the composed value.
  const composed = [t1, t2, t3].filter(Boolean).join(' - ')

  const save = () => {
    setErr(null)
    start(async () => {
      const r = await editAllocatedTitle(lineId, {
        title1: t1 || null, title2: t2 || null, title3: t3 || null,
        full_title: full.trim() || null,
      })
      if (r.ok) { setOpen(false); router.refresh() }
      else setErr(r.error ?? 'Could not save the title.')
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
        title="Edit the title without changing the number"
      >
        ✎ Edit title
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/50 p-3">
      <p className="mb-2 text-xs font-semibold text-teal-900">
        Edit title — the number <span className="font-mono">{rdmc}</span> stays the same
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] font-medium text-slate-600">Title 1 (Area/Facility)
          <input value={t1} onChange={(e) => { setT1(e.target.value); const c = [e.target.value, t2, t3].filter(Boolean).join(' - '); if (full === composed) setFull(c) }}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" />
        </label>
        <label className="text-[11px] font-medium text-slate-600">Title 2 (Major desc.)
          <input value={t2} onChange={(e) => { setT2(e.target.value); const c = [t1, e.target.value, t3].filter(Boolean).join(' - '); if (full === composed) setFull(c) }}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" />
        </label>
        <label className="text-[11px] font-medium text-slate-600">Title 3 (Equipment)
          <input value={t3} onChange={(e) => { setT3(e.target.value); const c = [t1, t2, e.target.value].filter(Boolean).join(' - '); if (full === composed) setFull(c) }}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" />
        </label>
      </div>
      <label className="mt-2 block text-[11px] font-medium text-slate-600">Full title (as it appears against the number)
        <input value={full} onChange={(e) => setFull(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" />
      </label>
      <div className="mt-3 flex items-center justify-end gap-3">
        {err && <span className="text-xs text-red-600">{err}</span>}
        <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={pending} className="rounded-lg bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save title'}
        </button>
      </div>
    </div>
  )
}
