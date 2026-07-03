import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()

  // Get the current review task with full document context
  const { data: task } = await db.from('review_tasks')
    .select(`
      id, reviewer_email, sequence_number, status, date_sent, date_opened,
      date_completed, due_date, review_outcome_code, review_outcome_text,
      comment, markup_summary, is_manager_override, batch_id, document_version_id,
      document_versions (
        id, file_name, revision, revision_sort, doc_name, discipline,
        document_type, topic, ai_text, central_file_url, status,
        doc_unique_id, document_id, uploaded_at,
        batches (
          id, batch_guid, comments,
          packages(package_name, package_code),
          vendors(name, code)
        )
      )
    `)
    .eq('id', id).single()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const batchId = task.batch_id
  const dvId    = task.document_version_id
  const dv      = task.document_versions as any

  // 1. All review tasks for this document (the reviewer chain)
  const { data: docChain } = await db.from('review_tasks')
    .select('id, reviewer_email, sequence_number, status, review_outcome_code, review_outcome_text, comment, date_completed')
    .eq('document_version_id', dvId)
    .order('sequence_number', { ascending: true })

  // 2. All document_versions in this batch (so reviewer can navigate multi-doc batches)
  const { data: batchDocs } = await db.from('document_versions')
    .select('id, file_name, revision, doc_name, status')
    .eq('batch_id', batchId)

  // 3. My tasks across all docs in this batch (for multi-doc navigation)
  const { data: myProfile } = await db.from('users')
    .select('email, role').eq('auth_user_id', user.id).single()
  const myEmail = (myProfile as any)?.email ?? ''
  const canMarkupBeta = ['developer', 'admin', 'document_controller', 'engineering_manager'].includes((myProfile as any)?.role ?? '')

  const { data: myBatchTasks } = await db.from('review_tasks')
    .select('id, document_version_id, status, review_outcome_code, document_versions(file_name, revision, doc_name)')
    .eq('batch_id', batchId)
    .eq('reviewer_email', myEmail)
    .order('sequence_number', { ascending: true })

  // 4. Previous revisions of this logical document (read-only historical view)
  let previousRevisions: any[] = []
  if (dv?.document_id) {
    const { data: prevRevs } = await db.from('document_versions')
      .select('id, file_name, revision, revision_sort, status, uploaded_at, central_file_url, returned_at')
      .eq('document_id', dv.document_id)
      .neq('id', dvId)
      .order('revision_sort', { ascending: false })
    
    if (prevRevs?.length) {
      // For each previous revision, get the final review outcomes
      const prevWithOutcomes = await Promise.all(prevRevs.map(async (pv: any) => {
        const { data: completedTasks } = await db.from('review_tasks')
          .select('reviewer_email, sequence_number, review_outcome_code, comment, date_completed')
          .eq('document_version_id', pv.id)
          .eq('status', 'completed')
          .order('sequence_number', { ascending: true })
        return { ...pv, completedReviews: completedTasks ?? [] }
      }))
      previousRevisions = prevWithOutcomes
    }
  } else if (dv?.doc_unique_id) {
    // Fallback: find by similar doc_unique_id prefix (same document number, different batch)
    const docPrefix = dv.doc_unique_id?.replace(/-\d+$/, '')
    if (docPrefix) {
      const { data: prevRevs } = await db.from('document_versions')
        .select('id, file_name, revision, revision_sort, status, uploaded_at, central_file_url, returned_at')
        .like('doc_unique_id', `${docPrefix}%`)
        .neq('id', dvId)
        .order('uploaded_at', { ascending: false })
        .limit(5)
      previousRevisions = prevRevs ?? []
    }
  }

  // 5. Determine if current reviewer is last in sequence
  const pendingAfter = (docChain ?? []).filter(
    (t: any) => t.sequence_number > task.sequence_number && t.status === 'pending'
  )
  const isLastReviewer = pendingAfter.length === 0

  return NextResponse.json({
    task,
    docChain:         docChain ?? [],
    batchDocs:        batchDocs ?? [],
    myBatchTasks:     myBatchTasks ?? [],
    previousRevisions,
    isLastReviewer,
    myEmail,
    canMarkupBeta,
  })
}
