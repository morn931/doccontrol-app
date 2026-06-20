import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FileText, Inbox, Clock, CheckCircle, Send, AlertTriangle, RotateCcw, XCircle } from 'lucide-react'
import { BATCH_STATUS_LABELS, BATCH_STATUS_COLORS } from '@/lib/utils/batch-status'
import { format, formatDistanceToNow } from 'date-fns'
import Link from 'next/link'

async function getDashboardStats() {
  const db = createServiceClient()

  const [
    { count: awaitingAction },
    { count: inReview },
    { count: reviewComplete },
    { count: returned },
    { count: rejected },
    { data: recentBatches },
    { count: overdueReviews },
  ] = await Promise.all([
    db.from('batches').select('*', { count: 'exact', head: true })
      .in('status', ['intake_received','metadata_pending','ready_for_reviewer_assignment']),
    db.from('batches').select('*', { count: 'exact', head: true })
      .in('status', ['review_in_progress','review_ready_to_start']),
    db.from('batches').select('*', { count: 'exact', head: true })
      .in('status', ['review_complete','transmittal_generated']),
    db.from('batches').select('*', { count: 'exact', head: true })
      .eq('status', 'returned_to_vendor'),
    db.from('batches').select('*', { count: 'exact', head: true })
      .eq('status', 'rejected_before_review'),
    db.from('batches')
      .select(`id, batch_guid, status, received_at, file_count, vendor_id,
               vendors(name, code), packages(package_code, package_name)`)
      .order('received_at', { ascending: false })
      .limit(8),
    db.from('review_tasks').select('*', { count: 'exact', head: true })
      .eq('status', 'overdue'),
  ])

  return { awaitingAction, inReview, reviewComplete, returned, rejected, recentBatches, overdueReviews }
}

interface StatCardProps {
  label: string; value: number | null; icon: React.ComponentType<{ className?: string }>
  color: string; href?: string
}
function StatCard({ label, value, icon: Icon, color, href }: StatCardProps) {
  const content = (
    <div className={`card p-5 ${href ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{label}</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{value ?? 0}</p>
        </div>
        <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

export default async function DashboardPage() {
  const { awaitingAction, inReview, reviewComplete, returned, rejected, recentBatches, overdueReviews } =
    await getDashboardStats()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">PPE Tech Document Control Overview</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Awaiting Action"   value={awaitingAction}  icon={Inbox}        color="bg-blue-500"   href="/batches?status=pending" />
        <StatCard label="In Review"         value={inReview}        icon={Clock}        color="bg-orange-500" href="/batches?status=in_review" />
        <StatCard label="Ready to Return"   value={reviewComplete}  icon={CheckCircle}  color="bg-teal-500"   href="/batches?status=complete" />
        <StatCard label="Returned to Vendor" value={returned}       icon={Send}         color="bg-green-500"  href="/batches?status=returned" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Rejected Batches"  value={rejected}        icon={XCircle}      color="bg-red-500"    href="/batches?status=rejected" />
        <StatCard label="Overdue Reviews"   value={overdueReviews}  icon={AlertTriangle} color="bg-amber-500" href="/reviews?status=overdue" />
      </div>

      {/* Recent batches */}
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Recent Batches</h2>
          <Link href="/batches" className="text-sm text-navy-600 hover:text-navy-800 font-medium">View all →</Link>
        </div>
        <div className="divide-y divide-slate-50">
          {!recentBatches?.length && (
            <div className="px-6 py-10 text-center text-slate-400">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>No batches yet. Run the import or connect the intake webhook.</p>
            </div>
          )}
          {recentBatches?.map((batch: any) => (
            <Link key={batch.id} href={`/batches/${batch.id}`}
              className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-900 truncate">
                    {batch.packages?.package_name ?? batch.packages?.package_code ?? 'Unknown Package'}
                  </p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${BATCH_STATUS_COLORS[batch.status as keyof typeof BATCH_STATUS_COLORS] ?? 'bg-slate-100 text-slate-600'}`}>
                    {BATCH_STATUS_LABELS[batch.status as keyof typeof BATCH_STATUS_LABELS] ?? batch.status}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {batch.vendors?.name ?? 'Unknown Vendor'} · {batch.file_count} file{batch.file_count !== 1 ? 's' : ''} ·{' '}
                  {formatDistanceToNow(new Date(batch.received_at), { addSuffix: true })}
                </p>
              </div>
              <span className="text-slate-300 text-lg">›</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
