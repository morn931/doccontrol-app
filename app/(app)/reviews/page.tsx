import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { ClipboardCheck, Clock, CheckCircle, AlertTriangle, FileText } from 'lucide-react'
import Link from 'next/link'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import { outcomeColorClass } from '@/lib/utils/outcome-codes'
import type { ReviewOutcomeCode } from '@/lib/types/database'

export default async function ReviewsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const db = createServiceClient()

  const { data: profile } = await db
    .from('users')
    .select('email')
    .eq('auth_user_id', user?.id ?? '')
    .single()

  const email = profile?.email ?? ''

  const { data: tasks } = await db
    .from('review_tasks')
    .select(`
      id, status, sequence_number, date_sent, date_completed, due_date,
      review_outcome_code, comment, is_manager_override, batch_id, document_version_id,
      document_versions(
        id, file_name, doc_name, revision, discipline,
        documents!document_versions_document_id_fkey(id, normalized_document_number)
      ),
      batches(id, batch_guid, packages(package_code, package_name), vendors(name))
    `)
    .eq('reviewer_email', email)
    .order('date_sent', { ascending: false })
    .limit(200)

  // Group tasks by batch_id — the batch is the unit of work
  const batchMap = new Map<string, { tasks: any[]; batch: any }>()
  for (const task of tasks ?? []) {
    const key = task.batch_id ?? 'no-batch'
    if (!batchMap.has(key)) {
      batchMap.set(key, { tasks: [], batch: (task as any).batches })
    }
    batchMap.get(key)!.tasks.push(task)
  }

  // Classify each batch group
  const pendingBatches: { key: string; tasks: any[]; batch: any; firstPendingTaskId: string; allComplete: boolean }[] = []
  const completedBatches: { key: string; tasks: any[]; batch: any; firstPendingTaskId: string; allComplete: boolean }[] = []

  for (const [key, { tasks: bTasks, batch }] of batchMap) {
    const pending = bTasks.filter(t => ['pending','sent','opened','in_progress'].includes(t.status))
    const allComplete = pending.length === 0
    const firstPending = bTasks.find(t => ['in_progress','sent','opened','pending'].includes(t.status)) ?? bTasks[0]
    const entry = { key, tasks: bTasks, batch, firstPendingTaskId: firstPending?.id ?? bTasks[0]?.id, allComplete }
    if (allComplete) completedBatches.push(entry)
    else pendingBatches.push(entry)
  }

  const overdueCount = pendingBatches.filter(b =>
    b.tasks.some(t => t.due_date && isPast(new Date(t.due_date)) && !['completed'].includes(t.status))
  ).length

  function BatchCard({ entry }: { entry: typeof pendingBatches[0] }) {
    const { tasks: bTasks, batch, firstPendingTaskId, allComplete } = entry
    const pending   = bTasks.filter(t => ['pending','sent','opened','in_progress'].includes(t.status))
    const completed = bTasks.filter(t => t.status === 'completed')
    const inProgress = bTasks.some(t => t.status === 'in_progress')
    const isOverdue = !allComplete && bTasks.some(t => t.due_date && isPast(new Date(t.due_date)))
    const seqNum    = bTasks[0]?.sequence_number ?? 1
    const dueDates  = bTasks.map(t => t.due_date).filter(Boolean).sort()
    const earliestDue = dueDates[0] ?? null
    const latestSent  = [...bTasks].sort((a, b) => new Date(b.date_sent ?? 0).getTime() - new Date(a.date_sent ?? 0).getTime())[0]?.date_sent
    const docCount  = bTasks.length

    // For completed batches — pick worst outcome
    const outcomes = completed.map(t => t.review_outcome_code).filter(Boolean)
    const severity: Record<string, number> = { A1:1, D1:2, B1:3, B2:4, C1:5, Q1:6, V1:7, S1:8 }
    const worstOutcome = outcomes.sort((a, b) => (severity[b] ?? 0) - (severity[a] ?? 0))[0]

    return (
      <Link href={`/reviews/${firstPendingTaskId}`}
        className="flex items-start gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
          allComplete   ? 'bg-green-100 text-green-700' :
          isOverdue     ? 'bg-red-100 text-red-700' :
          inProgress    ? 'bg-orange-100 text-orange-700' :
          'bg-navy-100 text-navy-700'
        }`}>
          {seqNum}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">
              {batch?.packages?.package_name ?? batch?.packages?.package_code ?? 'Unknown Package'}
            </span>
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium">
              <FileText className="h-3 w-3" />
              {docCount} doc{docCount !== 1 ? 's' : ''}
            </span>
            {worstOutcome && (
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(worstOutcome as ReviewOutcomeCode)}`}>
                {worstOutcome}
              </span>
            )}
          </div>
          {/* Document list */}
          <div className="mt-1 space-y-0.5">
            {bTasks.slice(0, 4).map((t: any) => {
              const dv = t.document_versions as any
              const label = dv?.documents?.normalized_document_number ?? dv?.file_name ?? 'Unknown'
              return (
                <div key={t.id} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    t.status === 'completed'   ? 'bg-green-500' :
                    t.status === 'in_progress' ? 'bg-orange-400' :
                    'bg-slate-300'
                  }`} />
                  <span className="font-mono">{label}</span>
                  {dv?.revision && <span className="px-1 bg-navy-50 text-navy-600 rounded font-mono">Rev {dv.revision}</span>}
                </div>
              )
            })}
            {bTasks.length > 4 && (
              <div className="text-xs text-slate-400 pl-3">+{bTasks.length - 4} more</div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs text-slate-400 mt-1">
            {batch?.vendors?.name && <span>{batch.vendors.name}</span>}
            {latestSent && <span>· Sent {formatDistanceToNow(new Date(latestSent), { addSuffix: true })}</span>}
            {earliestDue && (
              <span className={isOverdue ? 'text-red-600 font-semibold' : ''}>
                · Due {format(new Date(earliestDue), 'd MMM yyyy')}
                {isOverdue && ' ⚠️ OVERDUE'}
              </span>
            )}
            {!allComplete && <span>· {completed.length}/{docCount} reviewed</span>}
          </div>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
          allComplete ? 'bg-green-100 text-green-700' :
          isOverdue   ? 'bg-red-100 text-red-700' :
          inProgress  ? 'bg-orange-100 text-orange-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {allComplete ? 'completed' : isOverdue ? 'overdue' : inProgress ? 'in progress' : 'sent'}
        </span>
      </Link>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Reviews</h1>
        <p className="text-slate-500 text-sm mt-1">Your assigned document batches for review</p>
      </div>

      {overdueCount > 0 && (
        <div className="card border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800">You have {overdueCount} overdue batch{overdueCount !== 1 ? 'es' : ''}</p>
            <p className="text-sm text-red-700 mt-0.5">Please complete these as soon as possible.</p>
          </div>
        </div>
      )}

      {/* Pending batches */}
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <Clock className="h-4 w-4 text-orange-500" />
          <h2 className="font-semibold text-slate-900">Pending / In Progress</h2>
          <span className="ml-auto text-sm text-slate-400">{pendingBatches.length}</span>
        </div>
        {pendingBatches.length === 0 ? (
          <div className="py-10 text-center text-slate-400">
            <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>No pending reviews. You&apos;re all caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {pendingBatches.map(entry => <BatchCard key={entry.key} entry={entry} />)}
          </div>
        )}
      </div>

      {/* Completed batches */}
      {completedBatches.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <h2 className="font-semibold text-slate-900">Completed</h2>
            <span className="ml-auto text-sm text-slate-400">{completedBatches.length}</span>
          </div>
          <div className="divide-y divide-slate-50">
            {completedBatches.slice(0, 20).map(entry => <BatchCard key={entry.key} entry={entry} />)}
          </div>
          {completedBatches.length > 20 && (
            <div className="px-6 py-3 text-sm text-slate-400 text-center">
              Showing 20 of {completedBatches.length} completed batches.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
