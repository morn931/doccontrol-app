'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, FileText, ExternalLink, ChevronRight, Loader2, X } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

const DISCIPLINES = ['Electrical','Instrumentation','Automation','Mechanical','Civil','Commercial']
const DOC_TYPES   = ['Specification','Drawing','Calculation','Datasheet','RFI','Contract Notice','Change Request','Commercial Letter']

const STATUS_LABELS: Record<string, string> = {
  uploaded:'Uploaded', processing:'Processing', ready:'Ready',
  under_review:'In Review', review_complete:'Reviewed',
  returned:'Returned', rejected:'Rejected', superseded:'Superseded',
}
const STATUS_COLORS: Record<string, string> = {
  uploaded:       'bg-gray-100 text-gray-600',
  processing:     'bg-yellow-100 text-yellow-700',
  ready:          'bg-blue-100 text-blue-700',
  under_review:   'bg-orange-100 text-orange-700',
  review_complete:'bg-teal-100 text-teal-700',
  returned:       'bg-green-100 text-green-700',
  rejected:       'bg-red-100 text-red-700',
  superseded:     'bg-gray-100 text-gray-400',
}

export default function DocumentsPage() {
  const [query,       setQuery]       = useState('')
  const [discipline,  setDiscipline]  = useState('')
  const [docType,     setDocType]     = useState('')
  const [allRevisions,setAllRevisions]= useState(false)
  const [results,     setResults]     = useState<any[]>([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [searched,    setSearched]    = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Derive active search terms for chips display
  const activeTerms = query.split(/[,;]+/).map(t => t.trim()).filter(Boolean)

  const doSearch = useCallback(async (q: string, disc: string, dt: string, allRev: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q)      params.set('q', q)
      if (disc)   params.set('discipline', disc)
      if (dt)     params.set('doc_type', dt)
      if (allRev) params.set('all_revisions', '1')
      const res  = await fetch(`/api/documents/search?${params}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Search failed'); setResults([]) }
      else         { setResults(data.results ?? []) }
    } catch (e: any) {
      setError(e.message)
      setResults([])
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [])

  // Live search: debounce 300ms on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query && !discipline && !docType) {
      // Nothing typed — show empty state, don't fire a request
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      doSearch(query, discipline, docType, allRevisions)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, discipline, docType, allRevisions, doSearch])

  function clearAll() {
    setQuery(''); setDiscipline(''); setDocType(''); setAllRevisions(false)
    setResults([]); setSearched(false)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Document Search</h1>
        <p className="text-gray-500 text-sm mt-1">
          Results update live as you type. Separate multiple keywords with commas to match all terms —
          e.g. <span className="font-mono bg-gray-100 px-1 rounded text-xs">MCC, condenser, diagram</span>
        </p>
      </div>

      {/* Search bar */}
      <div className="card p-4 space-y-3">
        <div className="relative">
          {loading
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-navy-500 animate-spin" />
            : <Search  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          }
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g.  6105AK137   or   MCC, condenser, drawing   or   ECAL, electrical"
            className="input pl-9 pr-9"
            autoFocus
          />
          {query && (
            <button onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <select value={discipline} onChange={e => setDiscipline(e.target.value)} className="input w-auto text-sm">
            <option value="">All Disciplines</option>
            {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={docType} onChange={e => setDocType(e.target.value)} className="input w-auto text-sm">
            <option value="">All Doc Types</option>
            {DOC_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={allRevisions} onChange={e => setAllRevisions(e.target.checked)} className="rounded" />
            Show all revisions
          </label>
          {(query || discipline || docType) && (
            <button onClick={clearAll} className="text-sm text-gray-400 hover:text-gray-600 ml-auto">
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Active term chips (multi-term) */}
      {activeTerms.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Matching all of:</span>
          {activeTerms.map(t => (
            <span key={t} className="px-2.5 py-1 bg-navy-100 text-navy-700 rounded-full text-xs font-semibold">
              {t}
            </span>
          ))}
          {!loading && searched && (
            <span className="text-xs text-gray-400 ml-1">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && <div className="card p-4 text-red-700 bg-red-50 text-sm">{error}</div>}

      {/* Results */}
      <div className="card divide-y divide-gray-50">
        {!searched && !loading ? (
          <div className="py-16 text-center text-gray-400">
            <Search className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-gray-500">Start typing to search</p>
            <p className="text-sm mt-1">Search across document numbers, titles, disciplines, and AI summaries</p>
          </div>
        ) : loading && results.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin opacity-40" />
            <p className="text-sm">Searching…</p>
          </div>
        ) : results.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No documents found</p>
            <p className="text-sm mt-1">Try fewer or different keywords</p>
          </div>
        ) : (
          <>
            {results.map((dv: any) => (
              <div key={dv.id} className="px-6 py-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-gray-900">{dv.file_name}</span>
                    {dv.revision && (
                      <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">
                        Rev {dv.revision}
                      </span>
                    )}
                    {dv.is_latest && (
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-semibold">LATEST</span>
                    )}
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[dv.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[dv.status] ?? dv.status}
                    </span>
                  </div>

                  {dv.doc_name && dv.doc_name !== dv.file_name && (
                    <p className="text-sm text-gray-700 font-medium truncate">{dv.doc_name}</p>
                  )}

                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                    {dv.batches?.vendors?.name    && <span>{dv.batches.vendors.name}</span>}
                    {dv.batches?.packages?.package_name && <span>· {dv.batches.packages.package_name}</span>}
                    {dv.discipline    && <span>· {dv.discipline}</span>}
                    {dv.document_type && <span>· {dv.document_type}</span>}
                    {dv.returned_at   && <span>· Returned {format(new Date(dv.returned_at), 'd MMM yyyy')}</span>}
                    {!dv.returned_at && dv.uploaded_at && <span>· Uploaded {format(new Date(dv.uploaded_at), 'd MMM yyyy')}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {dv.central_file_url && (
                    <a href={`/api/documents/${dv.id}/download-url`} target="_blank" rel="noopener noreferrer"
                      className="btn-secondary text-xs py-1.5 px-3">
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </a>
                  )}
                  {dv.document_id && (
                    <Link href={`/documents/${dv.document_id}`} className="btn-secondary text-xs py-1.5 px-3">
                      <ChevronRight className="h-3.5 w-3.5" /> Details
                    </Link>
                  )}
                </div>
              </div>
            ))}
            <div className="px-6 py-3 text-xs text-gray-400 text-right">
              {results.length} result{results.length !== 1 ? 's' : ''}
              {!allRevisions && ' · Latest revisions only'}
              {loading && <span className="ml-2 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> updating…</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
