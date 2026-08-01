import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { getGoLiveCutover } from '@/lib/golive'
import { Send, ExternalLink, Eye } from 'lucide-react'
import { format } from 'date-fns'
import { outcomeColorClass } from '@/lib/utils/outcome-codes'
import type { ReviewOutcomeCode } from '@/lib/types/database'

export default async function TransmittalsPage({ searchParams }: { searchParams: Promise<{ history?: string }> }) {
  const { history } = await searchParams
  const db = createServiceClient()
  // Go-live cutover: pre-cutover transmittals were tests / old-tool work.
  const cutover = history === '1' ? null : await getGoLiveCutover(db)
  let query = db
    .from('transmittals')
    .select('*, vendors(name), packages(package_name), batches(batch_guid)')
    .order('generated_at', { ascending: false })
    .limit(100)
  if (cutover) query = query.gte('generated_at', cutover)
  const { data: transmittals } = await query

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transmittal Register</h1>
        <p className="text-slate-500 text-sm mt-1">All generated transmittal packs</p>
        {cutover ? (
          <p className="text-xs text-slate-400 mt-1">
            Showing transmittals since go-live — earlier entries were tests.{' '}
            <Link href="/transmittals?history=1" className="text-teal-700 hover:underline font-medium">Show older</Link>
          </p>
        ) : history === '1' ? (
          <p className="text-xs text-slate-400 mt-1">
            Showing all including pre-go-live tests.{' '}
            <Link href="/transmittals" className="text-teal-700 hover:underline font-medium">Back to new only</Link>
          </p>
        ) : null}
      </div>

      <div className="card divide-y divide-slate-50">
        {!transmittals?.length ? (
          <div className="py-16 text-center text-slate-400">
            <Send className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No transmittals yet.</p>
          </div>
        ) : (
          transmittals.map((t: any) => (
            <div key={t.id} className="px-6 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-slate-900">{t.transmittal_number}</span>
                  {t.final_outcome_code && (
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(t.final_outcome_code as ReviewOutcomeCode)}`}>
                      {t.final_outcome_code}
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    t.status === 'sent' ? 'bg-green-100 text-emerald-700' :
                    t.status === 'draft' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>{t.status}</span>
                </div>
                <div className="text-sm text-slate-500 mt-0.5 space-x-3">
                  {t.vendors?.name && <span>{t.vendors.name}</span>}
                  {t.packages?.package_name && <span>· {t.packages.package_name}</span>}
                  <span>· Generated {format(new Date(t.generated_at), 'd MMM yyyy')}</span>
                  {t.returned_to_vendor_at && <span>· Returned {format(new Date(t.returned_to_vendor_at), 'd MMM yyyy')}</span>}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link href={`/transmittals/${t.id}`} className="btn-primary text-xs py-1.5 px-3">
                  <Eye className="h-3.5 w-3.5" /> Open
                </Link>
                {t.docx_url && (
                  <a href={t.docx_url} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs py-1.5 px-3">
                    <ExternalLink className="h-3.5 w-3.5" /> DOCX
                  </a>
                )}
                {t.pdf_url && (
                  <a href={t.pdf_url} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs py-1.5 px-3">
                    <ExternalLink className="h-3.5 w-3.5" /> PDF
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
