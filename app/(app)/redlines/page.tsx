import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { formatDistanceToNow, format } from 'date-fns'
import { Plus, UploadCloud } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Redline Register — every site redline and where it stands:
// In review → Awaiting As-Built (with engineer + how long) → Closed / Rejected.
const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  pending:          { label: 'In review',           cls: 'bg-blue-100 text-teal-700' },
  awaiting_asbuilt: { label: 'Awaiting As-Built',   cls: 'bg-amber-100 text-amber-700' },
  rejected:         { label: 'Rejected — re-mark',  cls: 'bg-red-100 text-red-700' },
  closed:           { label: 'Closed — As-Built issued', cls: 'bg-green-100 text-emerald-700' },
}

export default async function RedlineRegisterPage() {
  const db = createServiceClient()
  const { data: subs } = await db.from('redline_submission')
    .select('id, submitter_name, created_by_email, submitted_at, review_state, asbuilt_engineer_email, accepted_at, closed_at, batch_id, asbuilt_batch_id, status')
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(300)
  const ids = (subs ?? []).map(s => s.id)
  const { data: docs } = ids.length
    ? await db.from('redline_document').select('submission_id, drawing_number').in('submission_id', ids)
    : { data: [] as any[] }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Site Redlines</h1>
          <p className="text-slate-500 text-sm mt-1">
            Every redline from site and where it stands — from review through drafting to the issued As-Built.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/redlines/awaiting" className="btn-secondary text-sm">
            <UploadCloud className="h-4 w-4" /> Awaiting my As-Built
          </Link>
          <Link href="/redlines/new" className="btn-primary text-sm">
            <Plus className="h-4 w-4" /> Upload Redline
          </Link>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Drawings</th>
              <th className="px-4 py-2.5">Submitted by</th>
              <th className="px-4 py-2.5">Submitted</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">With</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(subs ?? []).length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No redlines yet.</td></tr>
            ) : (subs ?? []).map(s => {
              const nums = (docs ?? []).filter(d => d.submission_id === s.id).map(d => d.drawing_number)
              const chip = STATE_CHIP[s.review_state] ?? STATE_CHIP.pending
              return (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {nums.slice(0, 3).join(', ')}{nums.length > 3 ? ` +${nums.length - 3}` : ''}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.submitter_name ?? s.created_by_email}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    {s.submitted_at ? format(new Date(s.submitted_at), 'd MMM yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${chip.cls}`}>{chip.label}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {s.review_state === 'awaiting_asbuilt' && s.asbuilt_engineer_email
                      ? `${s.asbuilt_engineer_email}${s.accepted_at ? ` · ${formatDistanceToNow(new Date(s.accepted_at))}` : ''}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {s.batch_id && (
                      <Link href={`/batches/${s.batch_id}`} className="text-xs text-teal-700 hover:underline">redline batch</Link>
                    )}
                    {s.asbuilt_batch_id && (
                      <Link href={`/batches/${s.asbuilt_batch_id}`} className="ml-3 text-xs text-indigo-700 hover:underline">as-built batch</Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
