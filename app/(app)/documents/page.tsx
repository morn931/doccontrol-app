'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, FileText, Loader2, X, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const SOURCES = ['ALL', 'SDDR', 'CDDL', 'MDDR']
const OUTCOME_COLORS: Record<string, string> = {
  A1: 'bg-green-100 text-green-800', B1: 'bg-blue-100 text-blue-800', B2: 'bg-blue-100 text-blue-700',
  C1: 'bg-yellow-100 text-yellow-800', D1: 'bg-orange-100 text-orange-800', Q1: 'bg-red-100 text-red-700',
}
const SOURCE_COLORS: Record<string, string> = {
  SDDR: 'bg-purple-100 text-purple-700', CDDL: 'bg-teal-100 text-teal-700', MDDR: 'bg-navy-100 text-navy-700',
}

function Chip({ active, onClick, children, color = 'navy' }: any) {
  const on = color === 'teal' ? 'bg-teal-600 border-teal-600' : color === 'purple' ? 'bg-purple-600 border-purple-600'
    : color === 'amber' ? 'bg-amber-500 border-amber-500' : 'bg-navy-700 border-navy-700'
  return (
    <button onClick={onClick}
      className={cn('px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
        active ? `${on} text-white` : 'bg-white text-gray-600 border-gray-300 hover:border-navy-400 hover:text-navy-700')}>
      {children}
    </button>
  )
}

export default function DocumentsPage() {
  const [packages, setPackages] = useState<string[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [disciplines, setDisciplines] = useState<string[]>([])
  const [docTypes, setDocTypes] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])

  const [selPackage, setSelPackage] = useState('ALL')
  const [selVendor, setSelVendor] = useState('ALL')
  const [selSource, setSelSource] = useState('ALL')
  const [awarded, setAwarded] = useState<'true' | 'false'>('true')
  const [discipline, setDiscipline] = useState('')
  const [docType, setDocType] = useState('')
  const [status, setStatus] = useState('')
  const [docnum, setDocnum] = useState('')
  const [title, setTitle] = useState('')

  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const RENDER_CAP = 500

  // Meta (filters), awarded + package scoped
  useEffect(() => {
    const base = `/api/mddr/meta?awarded=${awarded}`
    const u = selPackage === 'ALL' ? base : `${base}&package=${encodeURIComponent(selPackage)}`
    fetch(u).then(r => r.json()).then(d => {
      if (selPackage === 'ALL') setPackages(d.packages ?? [])
      setVendors(d.vendors ?? [])
      setDisciplines(d.disciplines ?? [])
      setDocTypes(d.documentTypes ?? [])
      setStatuses(d.statuses ?? [])
    }).catch(() => {})
  }, [awarded, selPackage])

  const fetchRows = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const p = new URLSearchParams({ awarded, limit: '10000' })
      if (selPackage !== 'ALL') p.set('package', selPackage)
      if (selVendor !== 'ALL') p.set('vendor', selVendor)
      if (selSource !== 'ALL') p.set('source', selSource)
      if (discipline) p.set('discipline', discipline)
      if (docType) p.set('document_type', docType)
      if (status) p.set('status', status)
      if (docnum) p.set('docnum', docnum)
      if (title) p.set('title', title)
      const res = await fetch(`/api/mddr?${p}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Search failed'); setRows([]) }
      else { setRows(data.rows ?? []); setTotal(data.total ?? 0) }
    } catch (e: any) { setError(e.message); setRows([]) }
    finally { setLoading(false) }
  }, [awarded, selPackage, selVendor, selSource, discipline, docType, status, docnum, title])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchRows, (docnum || title) ? 250 : 0)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [fetchRows, docnum, title])

  function clearAll() {
    setSelPackage('ALL'); setSelVendor('ALL'); setSelSource('ALL'); setAwarded('true')
    setDiscipline(''); setDocType(''); setStatus(''); setDocnum(''); setTitle('')
  }

  const shown = rows.slice(0, RENDER_CAP)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Document Search</h1>
        <p className="text-gray-500 text-sm mt-1">Find any document across the Master Register (SDDR · CDDL · MDDR). Filters and searches narrow live.</p>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">Package:</span>
          {['ALL', ...packages].map(p => <Chip key={p} active={selPackage === p} onClick={() => { setSelPackage(p); setSelVendor('ALL') }}>{p}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">Vendor:</span>
          {['ALL', ...vendors].map(v => <Chip key={v} color="teal" active={selVendor === v} onClick={() => setSelVendor(v)}>{v}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">Source:</span>
          {SOURCES.map(s => <Chip key={s} color="purple" active={selSource === s} onClick={() => setSelSource(s)}>{s}</Chip>)}
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide ml-3">Show:</span>
          {([['true', 'Awarded docs'], ['false', 'Unawarded scope']] as const).map(([v, l]) =>
            <Chip key={v} color="amber" active={awarded === v} onClick={() => setAwarded(v)}>{l}</Chip>)}
        </div>

        <div className="flex flex-wrap gap-3 items-center pt-1">
          <select value={discipline} onChange={e => setDiscipline(e.target.value)} className="input w-auto text-sm py-1.5">
            <option value="">All Disciplines</option>
            {disciplines.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={docType} onChange={e => setDocType(e.target.value)} className="input w-auto text-sm py-1.5">
            <option value="">All Doc Types</option>
            {docTypes.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className="input w-auto text-sm py-1.5">
            <option value="">All Statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={clearAll} className="text-sm text-gray-400 hover:text-gray-600 ml-auto">Clear all</button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={docnum} onChange={e => setDocnum(e.target.value)} placeholder="Search Document Number…" className="input pl-9 pr-8" />
            {docnum && <button onClick={() => setDocnum('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Search within Title…" className="input pl-9 pr-8" />
            {title && <button onClick={() => setTitle('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>}
          </div>
        </div>
      </div>

      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}

      {/* Result count */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-navy-500" /> : <FileText className="h-4 w-4 text-gray-400" />}
        <span>{total.toLocaleString()} document{total !== 1 ? 's' : ''}</span>
        {total > RENDER_CAP && <span className="text-xs text-amber-600">· showing first {RENDER_CAP} — narrow your filters</span>}
      </div>

      {/* Results */}
      <div className="card divide-y divide-gray-50">
        {shown.length === 0 && !loading ? (
          <div className="py-16 text-center text-gray-400">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No documents found</p>
            <p className="text-sm mt-1">Adjust the filters or search terms</p>
          </div>
        ) : shown.map((r: any) => (
          <div key={r.id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold text-gray-900">{r.document_number ?? '—'}</span>
              {r.revision && <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">Rev {r.revision}</span>}
              {r.source_type && <span className={cn('px-1.5 py-0.5 rounded text-xs font-semibold', SOURCE_COLORS[r.source_type] ?? 'bg-gray-100 text-gray-600')}>{r.source_type}</span>}
              {r.review_outcome_code && <span className={cn('px-1.5 py-0.5 rounded text-xs font-semibold', OUTCOME_COLORS[r.review_outcome_code] ?? 'bg-gray-100 text-gray-700')}>{r.review_outcome_code}</span>}
              {r.progress_percent != null && <span className="text-xs text-gray-400">{Number(r.progress_percent).toFixed(0)}%</span>}
            </div>
            {r.document_title && <p className="text-sm text-gray-700 mt-0.5">{r.document_title}</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-0.5">
              {r.package_code && <span className="font-medium text-gray-600">{r.package_code}</span>}
              {r.vendor_name && <span>· {r.vendor_name}</span>}
              {r.discipline && <span>· {r.discipline}</span>}
              {r.document_type && <span>· {r.document_type}</span>}
              {r.document_status && <span>· {r.document_status}</span>}
              {r.tag_number && <span>· Tag {r.tag_number}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
