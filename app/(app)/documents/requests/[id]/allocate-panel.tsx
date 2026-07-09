'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { allocateLine } from '../actions'

export type LineForAlloc = {
  id: string
  area_code: string | null
  discipline_code: string | null
  document_type_code: string | null
  title1: string | null
  title2: string | null
  title3: string | null
  rdmc_document_number: string | null
  ppe_doc_number: string | null
  full_title: string | null
  sequential_no: string | null
  line_status: string
}

export default function AllocatePanel({ line, projectNumber, packageCode }: {
  line: LineForAlloc; projectNumber: string; packageCode: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [rdmc, setRdmc] = useState(line.rdmc_document_number ?? '')
  const [ppe, setPpe] = useState(line.ppe_doc_number ?? '')
  const [seqno, setSeqno] = useState(line.sequential_no ?? '')
  const [full, setFull] = useState(line.full_title ?? [line.title1, line.title2, line.title3].filter(Boolean).join(' - '))

  const suggested = `${projectNumber}${packageCode ?? ''}-${line.area_code ?? 'CCCC'}-${(line.discipline_code ?? 'D')}${line.document_type_code ?? 'EEE'}-${(seqno || 'NNNN').padStart(seqno ? 4 : 0, '0')}`

  const save = () => {
    setErr(null)
    start(async () => {
      const r = await allocateLine(line.id, { rdmc_document_number: rdmc, ppe_doc_number: ppe, full_title: full, sequential_no: seqno })
      if (r.ok) router.refresh()
      else setErr(r.error ?? 'Could not save')
    })
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Document Control — allocate</div>
      <div className="mb-2 flex items-center gap-2">
        <input value={seqno} onChange={(e) => setSeqno(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Seq (NNNN)" className="w-24 rounded border border-slate-300 px-2 py-1 text-xs" />
        <span className="font-mono text-[11px] text-slate-500">{suggested}</span>
        <button type="button" onClick={() => setRdmc(suggested)} className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-white">Use</button>
      </div>
      <label className="block text-[11px] font-medium text-slate-500">RDMC Document Number
        <input value={rdmc} onChange={(e) => setRdmc(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block text-[11px] font-medium text-slate-500">PPE Doc Number
          <input value={ppe} onChange={(e) => setPpe(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs" />
        </label>
        <label className="block text-[11px] font-medium text-slate-500">Full Title
          <input value={full} onChange={(e) => setFull(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs" />
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between">
        {line.line_status === 'assigned'
          ? <span className="text-[11px] font-medium text-emerald-600">✓ allocated</span>
          : <span className="text-[11px] text-slate-400">pending</span>}
        <div className="flex items-center gap-2">
          {err && <span className="text-[11px] text-red-600">{err}</span>}
          <button onClick={save} disabled={pending} className="rounded bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
            {pending ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}
