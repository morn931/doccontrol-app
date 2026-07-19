'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, FileText, Loader2, X, Sparkles, ExternalLink, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { disciplineName, groupDisciplines } from '@/lib/mddr/disciplines'

const SOURCES = ['ALL', 'SDDR', 'CDDL', 'MDDR']
const OUTCOME_COLORS: Record<string, string> = {
  A1: 'bg-green-100 text-emerald-800', B1: 'bg-blue-100 text-teal-800', B2: 'bg-blue-100 text-teal-700',
  C1: 'bg-amber-100 text-amber-800', D1: 'bg-amber-100 text-amber-800', Q1: 'bg-red-100 text-red-700',
}
const SOURCE_COLORS: Record<string, string> = {
  SDDR: 'bg-teal-100 text-teal-700', CDDL: 'bg-teal-100 text-teal-700', MDDR: 'bg-navy-100 text-navy-700',
}

function Chip({ active, onClick, children, color = 'navy' }: any) {
  const on = color === 'teal' ? 'bg-teal-600 border-teal-600' : color === 'purple' ? 'bg-teal-600 border-teal-600'
    : color === 'amber' ? 'bg-amber-500 border-amber-500' : color === 'rose' ? 'bg-rose-600 border-rose-600'
    : 'bg-navy-700 border-navy-700'
  return (
    <button onClick={onClick}
      className={cn('px-3 py-1 lg:py-1 max-lg:py-1.5 max-lg:px-3.5 rounded-full text-xs font-semibold border transition-colors',
        active ? `${on} text-white` : 'bg-white text-slate-600 border-slate-300 hover:border-navy-400 hover:text-navy-700')}>
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
  const [revisions, setRevisions] = useState<string[]>([])
  const [sectors, setSectors] = useState<string[]>([])
  const [selSector, setSelSector] = useState('ALL')
  const [produced, setProduced] = useState<'files' | 'all'>('files')   // default: only docs with a file

  const [selPackage, setSelPackage] = useState('ALL')
  const [selVendor, setSelVendor] = useState('ALL')
  const [selSource, setSelSource] = useState('ALL')
  const [awarded, setAwarded] = useState<'true' | 'false'>('true')
  const [discipline, setDiscipline] = useState('')
  const [docType, setDocType] = useState('')
  const [status, setStatus] = useState('')
  const [revision, setRevision] = useState('')
  const [docnum, setDocnum] = useState('')
  const [title, setTitle] = useState('')
  const [smart, setSmart] = useState('')                 // natural-language semantic search
  const [smartRows, setSmartRows] = useState<any[]>([])
  const [smartLoading, setSmartLoading] = useState(false)

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
      setRevisions(d.revisions ?? [])
      setSectors(d.sectors ?? [])
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
      if (revision) p.set('revision', revision)
      if (selSector !== 'ALL') p.set('sector', selSector)
      if (produced === 'files') p.set('has_file', '1')
      if (docnum) p.set('docnum', docnum)
      if (title) p.set('title', title)
      const res = await fetch(`/api/mddr?${p}`)
      const text = await res.text()
      let data: any = {}; try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 200) } }
      if (!res.ok) { setError(data.error ?? 'Search failed'); setRows([]) }
      else { setRows(data.rows ?? []); setTotal(data.total ?? 0) }
    } catch (e: any) { setError(e.message); setRows([]) }
    finally { setLoading(false) }
  }, [awarded, selPackage, selVendor, selSource, discipline, docType, status, revision, selSector, produced, docnum, title])

  useEffect(() => {
    if (smart.trim()) { setLoading(false); return }   // Smart search owns the results — skip the filter query
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchRows, (docnum || title) ? 250 : 0)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [fetchRows, docnum, title, smart])

  // Semantic search (debounced). Respects the package / source / awarded chips.
  const smartRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const q = smart.trim()
    if (!q) { setSmartRows([]); setSmartLoading(false); return }
    setSmartLoading(true)
    if (smartRef.current) clearTimeout(smartRef.current)
    smartRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/mddr/semantic', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, package: selPackage, source: selSource, awarded }),
        })
        const text = await res.text()
        let data: any = {}; try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 200) } }
        setSmartRows(res.ok ? (data.rows ?? []) : [])
        setError(res.ok ? null : (data.error ?? 'Smart search failed'))
      } catch (e: any) { setError(e.message); setSmartRows([]) }
      finally { setSmartLoading(false) }
    }, 600)
    return () => { if (smartRef.current) clearTimeout(smartRef.current) }
  }, [smart, selPackage, selSource, awarded])

  function clearAll() {
    setSelPackage('ALL'); setSelVendor('ALL'); setSelSource('ALL'); setAwarded('true')
    setDiscipline(''); setDocType(''); setStatus(''); setRevision(''); setSelSector('ALL'); setProduced('files'); setDocnum(''); setTitle(''); setSmart('')
  }

  const isSmart = smart.trim().length > 0
  const shown = rows.slice(0, RENDER_CAP)
  const displayRows = isSmart ? smartRows : shown

  // Revisions drawer
  const [openId, setOpenId] = useState<string | null>(null)
  const [revs, setRevs] = useState<Record<string, any[]>>({})
  const [revLoading, setRevLoading] = useState(false)
  async function toggleRevs(r: any) {
    if (openId === r.id) { setOpenId(null); return }
    setOpenId(r.id)
    const key = r.normalized_document_number
    if (key && !(key in revs)) {
      setRevLoading(true)
      try {
        const d = await (await fetch(`/api/mddr/revisions?docnum=${encodeURIComponent(key)}`)).json()
        setRevs(p => ({ ...p, [key]: d.rows ?? [] }))
      } catch { setRevs(p => ({ ...p, [key]: [] })) }
      finally { setRevLoading(false) }
    }
  }
  const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString() : ''

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Document Search</h1>
        <p className="text-slate-500 text-sm mt-1">Find any document across the Master Register (SDDR · CDDL · MDDR). Filters and searches narrow live.</p>
      </div>

      {/* Smart (semantic) search */}
      <div className="card p-4 border-navy-200 bg-gradient-to-r from-navy-50/40 to-transparent">
        <label className="text-xs font-semibold text-navy-700 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Smart search — describe the document
        </label>
        <div className="relative">
          {smartLoading
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-navy-500 animate-spin" />
            : <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-navy-400" />}
          <input value={smart} onChange={e => setSmart(e.target.value)}
            placeholder="e.g.  earthing layout for the 220kV substation   ·   overhead line tension calculations"
            className="input pl-9 pr-9" />
          {smart && <button onClick={() => setSmart('')} aria-label="Clear" className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Meaning-based — finds documents by what they're about (from the AI summaries), even without exact keywords. Respects the Package / Source / Show filters below.
        </p>
      </div>

      {/* Filters */}
      <div className={cn('card p-4 space-y-3', isSmart && 'opacity-60')}>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Package:</span>
          {['ALL', ...packages].map(p => <Chip key={p} active={selPackage === p} onClick={() => { setSelPackage(p); setSelVendor('ALL') }}>{p}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Vendor:</span>
          {['ALL', ...vendors].map(v => <Chip key={v} color="teal" active={selVendor === v} onClick={() => setSelVendor(v)}>{v}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Source:</span>
          {SOURCES.map(s => <Chip key={s} color="purple" active={selSource === s} onClick={() => setSelSource(s)}>{s}</Chip>)}
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide ml-3">Show:</span>
          {([['true', 'Awarded docs'], ['false', 'Unawarded scope']] as const).map(([v, l]) =>
            <Chip key={v} color="amber" active={awarded === v} onClick={() => setAwarded(v)}>{l}</Chip>)}
        </div>

        {sectors.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Sector:</span>
            {['ALL', ...sectors].map(s => <Chip key={s} color="rose" active={selSector === s} onClick={() => setSelSector(s)}>{s}</Chip>)}
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-center pt-1">
          <select value={discipline} onChange={e => setDiscipline(e.target.value)} className="input w-auto text-sm py-1.5">
            <option value="">All Disciplines</option>
            {groupDisciplines(disciplines).map(g => <option key={g.label} value={g.raws.join(',')}>{g.label}</option>)}
          </select>
          <select value={docType} onChange={e => setDocType(e.target.value)} className="input w-auto text-sm py-1.5">
            <option value="">All Doc Types</option>
            {docTypes.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className="input w-auto text-sm py-1.5">
            <option value="">All Statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={revision} onChange={e => setRevision(e.target.value)} className="input w-auto text-sm py-1.5">
            <option value="">All Revisions</option>
            {revisions.map(r => <option key={r} value={r}>Rev {r}</option>)}
          </select>
          <button onClick={clearAll} className="rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:text-slate-600 ml-auto">Clear all</button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Scope:</span>
          {([['files', 'With documents produced'], ['all', 'Full MDDR (incl. placeholders)']] as const).map(([v, l]) =>
            <Chip key={v} color="navy" active={produced === v} onClick={() => setProduced(v)}>{l}</Chip>)}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={docnum} onChange={e => setDocnum(e.target.value)} placeholder="Search Document Number…" className="input pl-9 pr-8" />
            {docnum && <button onClick={() => setDocnum('')} aria-label="Clear" className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Search within Title…" className="input pl-9 pr-8" />
            {title && <button onClick={() => setTitle('')} aria-label="Clear" className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
          </div>
        </div>
      </div>

      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}

      {/* Result count */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {(loading || smartLoading) ? <Loader2 className="h-4 w-4 animate-spin text-navy-500" /> : <FileText className="h-4 w-4 text-slate-400" />}
        {isSmart
          ? <span>{displayRows.length.toLocaleString()} best matches for “{smart.trim()}”</span>
          : <><span>{total.toLocaleString()} document{total !== 1 ? 's' : ''}</span>
              {total > RENDER_CAP && <span className="text-xs text-amber-600">· showing first {RENDER_CAP} — narrow your filters</span>}</>}
      </div>

      {/* Results */}
      <div className="card divide-y divide-slate-50">
        {displayRows.length === 0 && !loading && !smartLoading ? (
          <div className="py-16 text-center text-slate-400">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No documents found</p>
            <p className="text-sm mt-1">{isSmart ? 'Try describing the document differently' : 'Adjust the filters or search terms'}</p>
          </div>
        ) : displayRows.map((r: any) => {
          const expanded = openId === r.id
          const revRows = revs[r.normalized_document_number] ?? []
          return (
          <div key={r.id} className="hover:bg-slate-50 transition-colors">
            <div className="px-5 py-3 flex items-start gap-3">
              <button onClick={() => toggleRevs(r)} aria-label={expanded ? "Hide revisions" : "Show revisions"} className="-m-2 shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-navy-600" title="Show revisions">
                {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-slate-900">{r.document_number ?? '—'}</span>
                  {r.revision && <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">Rev {r.revision}</span>}
                  {r.source_type && <span className={cn('px-1.5 py-0.5 rounded text-xs font-semibold', SOURCE_COLORS[r.source_type] ?? 'bg-slate-100 text-slate-600')}>{r.source_type}</span>}
                  {r.review_outcome_code && <span className={cn('px-1.5 py-0.5 rounded text-xs font-semibold', OUTCOME_COLORS[r.review_outcome_code] ?? 'bg-slate-100 text-slate-700')}>{r.review_outcome_code}</span>}
                  {r.progress_percent != null && <span className="text-xs text-slate-400">{Number(r.progress_percent).toFixed(0)}%</span>}
                  {isSmart && r.similarity != null && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-navy-100 text-navy-700">{Math.round(r.similarity * 100)}% match</span>
                  )}
                </div>
                {r.document_title && <p className="text-sm text-slate-700 mt-0.5">{r.document_title}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                  {r.package_code && <span className="font-medium text-slate-600">{r.package_code}</span>}
                  {r.vendor_name && <span>· {r.vendor_name}</span>}
                  {r.discipline && <span>· {disciplineName(r.discipline)}</span>}
                  {r.document_type && <span>· {r.document_type}</span>}
                  {r.document_status && <span>· {r.document_status}</span>}
                  {r.tag_number && <span>· Tag {r.tag_number}</span>}
                </div>
                {isSmart && r.ai_text && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 bg-slate-50 rounded px-2 py-1">{r.ai_text.replace(/\s+/g, ' ').slice(0, 240)}…</p>
                )}
              </div>
              {r.file_link
                ? <a href={`/api/mddr/open?id=${r.id}`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs py-1.5 px-3 shrink-0"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
                : <span className="text-xs text-slate-300 shrink-0 mt-1.5">no file</span>}
            </div>

            {expanded && (
              <div className="px-5 pb-3 pl-12">
                <div className="rounded-md border border-slate-100 bg-slate-50/60 divide-y divide-slate-100">
                  {revLoading && !(r.normalized_document_number in revs) ? (
                    <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> loading revisions…</div>
                  ) : revRows.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-slate-400 flex items-center justify-between">
                      <span>No prior revisions tracked{r.file_link ? ' — current file:' : ''}</span>
                      {r.file_link && <a href={`/api/mddr/open?id=${r.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-navy-600 hover:bg-navy-50 hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open</a>}
                    </div>
                  ) : revRows.map((rv: any, i: number) => (
                    <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                      <span className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono font-bold">Rev {rv.revision ?? '—'}</span>
                      {i === 0 && <span className="px-1.5 py-0.5 bg-green-100 text-emerald-700 rounded font-semibold">LATEST</span>}
                      {rv.status && <span className="text-slate-500">{rv.status}</span>}
                      {rv.date && <span className="text-slate-400">{fmtD(rv.date)}</span>}
                      {rv.url
                        ? <a href={rv.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-navy-600 hover:bg-navy-50 hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
                        : <span className="ml-auto text-slate-300">no link</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}
