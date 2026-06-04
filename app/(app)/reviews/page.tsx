import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { ClipboardCheck, Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import { outcomeColorClass } from '@/lib/utils/outcome-codes'
import type { ReviewOutcomeCode } from '@/lib/types/database'

export default async function ReviewsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const db = createServiceClient()

  // Get current user's profile
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
      review_outcome_code, comment, is_manager_override,
      document_versions(
        id, file_name, doc_name, revision, discipline,
        documents!document_versions_document_id_fkey(id, normalized_document_number)
      ),
      batches(id, batch_guid, packages(package_code, package_name), vendors(name))
    `)
    .eq('reviewer_email', email)
    .order('date_sent', { ascending: false })
    .limit(100)

  const pending   = tasks?.filter(t => ['pending','sent','opened','in_progress'].includes(t.status)) ?? []
  const overdue   = pending.filter(t => t.due_date && isPast(new Date(t.due_date)))
  const completed = tasks?.filter(t => t.status === 'completed') ?? []

  function TaskCard({ task }: { task: any }) {
    const dv   = task.document_versions as any
    const batch = task.batches as any
    const isOverdue = task.due_date && isPast(new Date(task.due_date)) && task.status !== 'completed'

    return (
      <Link href={`/reviews/${task.id}`}
        className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
          task.status === 'completed'   ? 'bg-green-100 text-green-700' :
          isOverdue                     ? 'bg-red-100 text-red-700' :
          task.status === 'in_progress' ? 'bg-orange-100 text-orange-700' :
          'bg-navy-100 text-navy-700'
        }`}>
          {task.sequence_number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-gray-900">
              {dv?.documents?.normalized_document_number ?? dv?.file_name ?? 'Unknown'}
            </span>
            {dv?.revision && <span className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">Rev {dv.revision}</span>}
            {task.is_manager_override && (
              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-semibold">Manager Override</span>
            )}
            {task.review_outcome_code && (
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${outcomeColorClass(task.review_outcome_code as ReviewOutcomeCode)}`}>
                {task.review_outcome_code}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-0.5">{dv?.doc_name ?? dv?.file_name}</p>
          <div className="flex flex-wrap gap-x-3 text-xs text-gray-400 mt-0.5">
            {batch?.vendors?.name && <span>{batch.vendors.name}</span>}
            {batch?.packages?.package_name && <span>· {batch.packages.package_name}</span>}
            {task.date_sent && <span>· Sent {formatDistanceToNow(new Date(task.date_sent), { addSuffix: true })}</span>}
            {task.due_date && (
              <span className={isOverdue ? 'text-red-600 font-semibold' : ''}>
                · Due {format(new Date(task.due_date), 'd MMM yyyy')}
                {isOverdue && ' ⚠️ OVERDUE'}
              </span>
            )}
          </div>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
          task.status === 'completed'   ? 'bg-green-100 text-green-700' :
          isOverdue                     ? 'bg-red-100 text-red-700' :
          task.status === 'in_progress' ? 'bg-orange-100 text-orange-700' :
          task.status === 'sent'        ? 'bg-blue-100 text-blue-700' :
          'bg-gray-100 text-gray-600'
        }`}>
          {isOverdue ? 'Overdue' : task.status}
        </span>
      </Link>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Reviews</h1>
        <p className="text-gray-500 text-sm mt-1">Your assigned document review tasks</p>
      </div>

      {overdue.length > 0 && (
        <div className="card border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800">You have {overdue.length} overdue review{overdue.length !== 1 ? 's' : ''}</p>
            <p className="text-sm text-red-700 mt-0.5">Please complete these as soon as possible.</p>
          </div>
        </div>
      )}

      {/* Pending */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Clock className="h-4 w-4 text-orange-500" />
          <h2 className="font-semibold text-gray-900">Pending / In Progress</h2>
          <span className="ml-auto text-sm text-gray-400">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>No pending reviews. You&apos;re all caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {pending.map(task => <TaskCard key={task.id} task={task} />)}
          </div>
        )}
      </div>

      {/* Completed */}
      {completed.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <h2 className="font-semibold text-gray-900">Completed</h2>
            <span className="ml-auto text-sm text-gray-400">{completed.length}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {completed.slice(0, 20).map(task => <TaskCard key={task.id} task={task} />)}
          </div>
          {completed.length > 20 && (
            <div className="px-6 py-3 text-sm text-gray-400 text-center">
              Showing 20 of {completed.length} completed reviews.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
