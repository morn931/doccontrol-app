'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createRequest, type LineInput } from '../requests/actions'
import NumberPicker from './number-picker'

type Opt = { code: string; name: string }
type Pkg = { id: string; code: string; name: string }
type Line = LineInput & { key: number }

let seq = 0
const blank = (): Line => ({ key: ++seq, revision: 'A' })

export default function RequestForm({ documentTypes, disciplines, areas, packages }: {
  documentTypes: Opt[]; disciplines: Opt[]; areas: Opt[]; packages: Pkg[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [packageCode, setPackageCode] = useState('')
  const [dueBy, setDueBy] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blank(), blank(), blank()])
  const [gateOpen, setGateOpen] = useState(false)

  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls))

  const submit = () => {
    setErr(null)
    const pkg = packages.find((p) => p.code === packageCode)
    start(async () => {
      const r = await createRequest({
        package_code: packageCode || undefined,
        package_id: pkg?.id ?? null,
        response_required_by: dueBy || null,
        notes: notes || undefined,
        lines: lines.map(({ key: _key, ...l }) => l),
      })
      if (r.ok) router.push('/documents/requests')
      else setErr(r.error ?? 'Could not submit')
    })
  }

  const sel = (value: string | undefined, onChange: (v: string) => void, opts: Opt[], placeholder: string) => (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs">
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.name}</option>)}
    </select>
  )

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Request a document number</h1>
          <p className="text-sm text-slate-500">The Document Controller allocates the RDMC number for each line.</p>
        </div>
        <Link href="/documents/requests" className="text-sm font-medium text-teal-700 hover:underline">← Requests</Link>
      </div>

      <NumberPicker onConfirmNone={() => setGateOpen(true)} confirmed={gateOpen} />

      {!gateOpen && (
        <p className="mb-2 text-xs text-slate-400">The new-number form below unlocks once you confirm no existing number fits.</p>
      )}
      <div className={`rounded-xl border border-slate-200 bg-white p-4 transition ${gateOpen ? '' : 'pointer-events-none select-none opacity-40'}`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-slate-600">Package
            <select value={packageCode} onChange={(e) => setPackageCode(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Select…</option>
              {packages.map((p) => <option key={p.id} value={p.code}>{p.code}{p.name ? ` — ${p.name}` : ''}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Response required by
            <input type="date" value={dueBy} onChange={(e) => setDueBy(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-slate-600">Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
        </div>

        <div className="mt-4">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col className="w-[3%]" /><col className="w-[12%]" /><col className="w-[11%]" /><col className="w-[11%]" />
              <col className="w-[12%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[4%]" />
              <col className="w-[10%]" /><col className="w-[9%]" /><col className="w-[2%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[11px] text-slate-500">
                <th className="px-1 py-1 font-medium">#</th>
                <th className="px-1 py-1 font-medium">Document Type</th>
                <th className="px-1 py-1 font-medium">Discipline</th>
                <th className="px-1 py-1 font-medium">Area / WBS</th>
                <th className="px-1 py-1 font-medium">Title 1 (Area/Facility)</th>
                <th className="px-1 py-1 font-medium">Title 2 (Major desc.)</th>
                <th className="px-1 py-1 font-medium">Title 3 (Equipment)</th>
                <th className="px-1 py-1 font-medium">Rev</th>
                <th className="px-1 py-1 font-medium">Due</th>
                <th className="px-1 py-1 font-medium">Comments</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr key={l.key} className="align-top">
                  <td className="px-1 py-1 text-slate-400">{i + 1}</td>
                  <td className="px-1 py-1">{sel(l.document_type_code, (v) => set(l.key, { document_type_code: v }), documentTypes, 'Type…')}</td>
                  <td className="px-1 py-1">{sel(l.discipline_code, (v) => set(l.key, { discipline_code: v }), disciplines, 'Discipline…')}</td>
                  <td className="px-1 py-1">{sel(l.area_code, (v) => set(l.key, { area_code: v }), areas, 'Area…')}</td>
                  <td className="px-1 py-1"><input value={l.title1 ?? ''} onChange={(e) => set(l.key, { title1: e.target.value })} className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs" /></td>
                  <td className="px-1 py-1"><input value={l.title2 ?? ''} onChange={(e) => set(l.key, { title2: e.target.value })} className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs" /></td>
                  <td className="px-1 py-1"><input value={l.title3 ?? ''} onChange={(e) => set(l.key, { title3: e.target.value })} className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs" /></td>
                  <td className="px-1 py-1"><input value={l.revision ?? ''} onChange={(e) => set(l.key, { revision: e.target.value })} className="w-full rounded border border-slate-300 px-1 py-1 text-center text-xs" /></td>
                  <td className="px-1 py-1"><input type="date" value={l.due_date ?? ''} onChange={(e) => set(l.key, { due_date: e.target.value })} className="w-full rounded border border-slate-300 px-1 py-1 text-xs" /></td>
                  <td className="px-1 py-1"><input value={l.comments ?? ''} onChange={(e) => set(l.key, { comments: e.target.value })} className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs" /></td>
                  <td className="px-1 py-1 text-center"><button onClick={() => removeLine(l.key)} className="text-slate-300 hover:text-red-600" title="Remove line">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => setLines((ls) => [...ls, blank()])} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">+ Add line</button>
          <div className="flex items-center gap-3">
            {err && <span className="text-xs text-red-600">{err}</span>}
            <button onClick={submit} disabled={pending} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
              {pending ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
