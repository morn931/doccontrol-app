import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText, ExternalLink, History } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'
import { OUTCOME_CODES, outcomeColorClass } from '@/lib/utils/outcome-codes'
import type { ReviewOutcomeCode } from '@/lib/types/database'

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = createServiceClient()

  const { data: doc } = await db
    .from('documents')
    .select(`
      id, normalized_document_number, display_document_number, title,
      discipline, document_type, topic, current_version_id,
      vendors(name, code), packages(package_code, package_name),
      document_versions(
        id, file_name, revision, revision_sort, status, is_latest,
        central_file_url, returned_file_url, uploaded_at, returned_at,
        doc_name, ai_text, review_outcome_code, ai_metadata_source,
        batches(id, batch_guid, received_at)
      )
    `)
    .eq('id', id)
    .single()

  if (!doc) notFound()

  const versions = (doc.document_versions as any[])
    ?.sort((a: any, b: any) => (b.revision_sort ?? '').localeCompare(a.revision_sort ?? ''))
  const latest = versions?.find((v: any) => v.is_latest) ?? versions?.[0]

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/documents" className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Search
        </Link>
      </div>

      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-navy-100 rounded-lg flex items-center justify-center">
            <FileText className="h-6 w-6 text-navy-700" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900 font-mono">
              {doc.normalized_document_number ?? doc.display_document_number ?? 'Unknown'}
            </h1>
            <p className="text-slate-700 mt-1">{latest?.doc_name ?? doc.title ?? latest?.file_name}</p>
            <div className="flex flex-wrap gap-3 mt-3 text-sm text-slate-600">
              {(doc.vendors as any)?.name && <span className="font-medium">{(doc.vendors as any).name}</span>}
              {(doc.packages as any)?.package_name && <span>· {(doc.packages as any).package_name}</span>}
              {doc.discipline    && <span>· {doc.discipline}</span>}
              {doc.document_type && <span>· {doc.document_type}</span>}
              {doc.topic         && <span>· {doc.topic}</span>}
            </div>
          </div>
          {latest?.central_file_url && (
            <a href={`/api/documents/${latest.id}/download-url`} target="_blank"
              rel="noopener noreferrer" className="btn-primary shrink-0">
              <ExternalLink className="h-4 w-4" /> Open Latest (Read-Only)
            </a>
          )}
        </div>
      </div>

      {/* AI Summary */}
      {latest?.ai_text && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            AI Classification Summary
            <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
              {latest.ai_metadata_source === 'manually_overridden' ? 'Manually overridden' :
               latest.ai_metadata_source === 'manually_confirmed' ? 'AI (confirmed)' : 'AI generated'}
            </span>
          </h2>
          <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
            {latest.ai_text}
          </pre>
        </div>
      )}

      {/* Revision history */}
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <History className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-900">Revision History</h2>
          <span className="ml-auto text-sm text-slate-400">{versions?.length ?? 0} revision{(versions?.length ?? 0) !== 1 ? 's' : ''}</span>
        </div>
        <div className="divide-y divide-slate-50">
          {versions?.map((v: any) => (
            <div key={v.id} className="px-6 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-medium text-slate-900">{v.file_name}</span>
                  {v.revision && (
                    <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">
                      Rev {v.revision}
                    </span>
                  )}
                  {v.is_latest && (
                    <span className="px-1.5 py-0.5 bg-green-100 text-emerald-700 rounded text-xs font-semibold">LATEST</span>
                  )}
                  {v.review_outcome_code && (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${outcomeColorClass(v.review_outcome_code as ReviewOutcomeCode)}`}>
                      {v.review_outcome_code} — {OUTCOME_CODES[v.review_outcome_code as ReviewOutcomeCode]?.text}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-1 space-x-3">
                  <span>Uploaded {format(new Date(v.uploaded_at), 'd MMM yyyy')}</span>
                  {v.returned_at && <span>· Returned {format(new Date(v.returned_at), 'd MMM yyyy')}</span>}
                  {v.batches && <span>· Batch {v.batches.batch_guid}</span>}
                </div>
              </div>
              {(v.central_file_url || v.returned_file_url) && (
                <a href={`/api/documents/${v.id}/download-url`} target="_blank"
                  rel="noopener noreferrer" className="btn-secondary text-xs py-1.5 px-3">
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
