'use client'
import { useState, useTransition } from 'react'
import { Search, ExternalLink } from 'lucide-react'
import { searchAconex, type AconexSearchRow } from './search-actions'

const COURT_CHIP: Record<string, string> = {
  RDMC: 'bg-amber-100 text-amber-800 border-amber-200',
  PPE: 'bg-rose-100 text-rose-800 border-rose-200',
  CLOSED: 'bg-slate-100 text-slate-600 border-slate-200',
  UNKNOWN: 'bg-slate-100 text-slate-500 border-slate-200',
}

export function AconexSearch() {
  const [q, setQ] = useState('')
  const [ppeOnly, setPpeOnly] = useState(false)
  const [rows, setRows] = useState<AconexSearchRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function run(e?: React.FormEvent) {
    e?.preventDefault()
    if (q.trim().length < 2) return
    setError(null)
    start(async () => {
      const res = await searchAconex(q, ppeOnly)
      if (res.ok) { setRows(res.results); setTotal(res.total) }
      else { setRows([]); setTotal(0); setError(res.error) }
    })
  }

  return (
    <div className="card p-4 space-y-3 border-navy-200">
      <div>
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Search className="h-4 w-4 text-navy-600" /> Search all Aconex documents
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Live search of the entire Reko Diq Aconex register (not limited to the tracked K124 pilot).
          Type a document number, title or package.
        </p>
      </div>

      <form onSubmit={run} className="flex items-center gap-2 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. 6105AK132, transformer, K137…"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-navy-300"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 select-none">
          <input type="checkbox" checked={ppeOnly} onChange={(e) => setPpeOnly(e.target.checked)} />
          PPE-authored only
        </label>
        <button
          type="submit"
          disabled={pending || q.trim().length < 2}
          className="rounded-lg bg-navy-600 text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50 hover:bg-navy-700"
        >
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {rows && !error && (
        <div className="text-xs text-slate-400">{total.toLocaleString()} match{total === 1 ? '' : 'es'} · showing {rows.length}</div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy-700 text-white text-left">
                <th className="px-3 py-2 font-semibold border-r border-navy-600">Document No</th>
                <th className="px-3 py-2 font-semibold border-r border-navy-600">Title</th>
                <th className="px-3 py-2 font-semibold border-r border-navy-600">Package</th>
                <th className="px-3 py-2 font-semibold border-r border-navy-600">Rev</th>
                <th className="px-3 py-2 font-semibold border-r border-navy-600">Doc status</th>
                <th className="px-3 py-2 font-semibold border-r border-navy-600">Review</th>
                <th className="px-3 py-2 font-semibold border-r border-navy-600">Whose court</th>
                <th className="px-3 py-2 font-semibold">Author</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.docId + i} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {r.hasFile ? (
                      <a
                        href={`/aconex-review/view?doc=${encodeURIComponent(r.docId)}&name=${encodeURIComponent(r.docno)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-navy-600 hover:underline"
                      >
                        {r.docno}
                      </a>
                    ) : (
                      <span className="text-slate-500" title="Reserved placeholder — no file uploaded in Aconex yet">
                        {r.docno} <span className="text-[10px] text-slate-400">(no file)</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700 max-w-xs">{r.title}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{r.package?.split(' ')[0]}</td>
                  <td className="px-3 py-2 text-slate-500">{r.revision && r.revision !== '-' ? r.revision : '—'}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{r.docStatus?.split(' ')[0]}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap text-xs">{r.reviewStatus}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${COURT_CHIP[r.court] ?? COURT_CHIP.UNKNOWN}`}>
                      {r.courtLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">
                    {r.authorOrg?.replace(' Pty Ltd', '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length === 0 && !error && (
        <div className="text-sm text-slate-500">No documents matched “{q}”.</div>
      )}

      <a
        href="https://eu1.aconex.com"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-navy-600 hover:underline"
      >
        Open Aconex <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}
