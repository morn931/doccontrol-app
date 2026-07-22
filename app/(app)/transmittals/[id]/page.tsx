import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { outcomeColorClass } from '@/lib/utils/outcome-codes'
import type { ReviewOutcomeCode } from '@/lib/types/database'
import { assembleTransmittalDocs, outcomeText } from '@/lib/services/transmittal-data'
import PrintButton from './print-button'
import { PrintHeader } from '@/components/print/PrintHeader'

export const dynamic = 'force-dynamic'

// Read-only view of a generated transmittal (rebuilt from current review data).
export default async function TransmittalViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const { data: t } = await db.from('transmittals')
    .select('*, vendors(name), packages(package_name, package_code), batches(batch_guid)')
    .eq('id', id).single()
  if (!t) redirect('/transmittals')

  const { documents, overallCode } = await assembleTransmittalDocs(db, t.batch_id)
  const oc = (t.final_outcome_code as string) || overallCode

  const meta: [string, string][] = [
    ['Transmittal Number', t.transmittal_number],
    ['Status', t.status ?? '—'],
    ['Vendor', (t.vendors as any)?.name ?? '—'],
    ['Project Package', `${(t.packages as any)?.package_code ?? ''}  —  ${(t.packages as any)?.package_name ?? ''}`],
    ['No. of Documents', String(documents.length)],
    ['Overall Outcome', `${oc} — ${outcomeText(oc)}`],
    ['Generated', t.generated_at ? format(new Date(t.generated_at), 'd MMMM yyyy') : '—'],
    ...(t.returned_to_vendor_at ? [['Returned', format(new Date(t.returned_to_vendor_at), 'd MMMM yyyy')] as [string, string]] : []),
  ]

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/transmittals" className="btn-secondary text-xs py-1.5 px-3"><ArrowLeft className="h-3.5 w-3.5" /> Transmittals</Link>
        <PrintButton />
      </div>

      <PrintHeader
        title={`TRANSMITTAL — ${t.transmittal_number}`}
        subtitle={`CoreDocs · ${(t.vendors as any)?.name ?? '—'} · ${(t.packages as any)?.package_code ?? ''} — ${(t.packages as any)?.package_name ?? ''}`}
        date={t.generated_at ? format(new Date(t.generated_at), 'd MMM yyyy') : '—'}
      />

      {/* on-screen only; PrintHeader carries the title in print */}
      <div className="print:hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900 font-mono">{t.transmittal_number}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(oc as ReviewOutcomeCode)}`}>{oc}</span>
        </div>
        <p className="text-slate-500 text-sm mt-0.5">Document Transmittal — read-only</p>
      </div>

      {/* transmittal number/outcome badge — kept visible in print too since it's the
          unique identifying info, not just decoration */}
      <div className="hidden print:flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900 font-mono">{t.transmittal_number}</h1>
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(oc as ReviewOutcomeCode)}`}>{oc}</span>
      </div>

      {/* Transmittal information */}
      <div className="card overflow-hidden">
        <div className="bg-navy-700 text-white px-4 py-2 text-sm font-semibold">Transmittal Information</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {meta.map(([k, v]) => (
              <tr key={k}>
                <td className="bg-slate-50 px-4 py-2 font-medium text-slate-600 w-52 align-top">{k}</td>
                <td className="px-4 py-2 text-slate-800 capitalize">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Document summary */}
      <div className="card overflow-hidden">
        <div className="bg-navy-700 text-white px-4 py-2 text-sm font-semibold">Document Summary</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs">
                <th className="px-3 py-2 text-left w-8">#</th>
                <th className="px-3 py-2 text-left">Document Number</th>
                <th className="px-3 py-2 text-left">Document Title</th>
                <th className="px-3 py-2 text-center w-14">Rev</th>
                <th className="px-3 py-2 text-center w-16">Code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((d, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-center text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{d.fileName}</td>
                  <td className="px-3 py-2 text-slate-700">{d.docName ?? d.fileName}</td>
                  <td className="px-3 py-2 text-center text-slate-600">{d.revision ?? '0'}</td>
                  <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(d.outcomeCode as ReviewOutcomeCode)}`}>{d.outcomeCode}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-document reviewer outcomes */}
      {documents.map((d, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 flex items-center gap-2">
            <span>Document {i + 1} of {documents.length} · {d.docName ?? d.fileName}</span>
            <span className={`ml-auto px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(d.outcomeCode as ReviewOutcomeCode)}`}>{d.outcomeCode}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs">
                  <th className="px-3 py-2 text-left w-40">Reviewer</th>
                  <th className="px-3 py-2 text-center w-14">Code</th>
                  <th className="px-3 py-2 text-left">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.reviewers.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-3 text-slate-400 text-center">No completed reviews.</td></tr>
                ) : d.reviewers.map((rv, j) => (
                  <tr key={j} className="align-top">
                    <td className="px-3 py-2 font-medium text-slate-800">{rv.name}</td>
                    <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(rv.code as ReviewOutcomeCode)}`}>{rv.code}</span></td>
                    <td className="px-3 py-2 text-slate-700 whitespace-pre-wrap">{rv.comment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
