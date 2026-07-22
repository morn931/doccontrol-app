import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { batchReviewAssignedEmail, reviewCompleteEmail } from '@/lib/services/email-templates'
import { markApprovalListRowComplete, markApprovalListRowSent } from '@/lib/services/sharepoint-lists'
import { logActivity } from '@/lib/activity'

const OUTCOME_SEVERITY: Record<string, number> = {
  A1:1, D1:2, B1:3, B2:4, C1:5, Q1:6, V1:7, S1:8
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('email, full_name')
    .eq('auth_user_id', user.id).single()

  const { id: taskId } = await params
  const body = await req.json()
  const { outcomeCode, comment, needMoreReview } = body

  if (!outcomeCode && !needMoreReview)
    return NextResponse.json({ error: 'Outcome code is required' }, { status: 400 })

  const db = createServiceClient()

  // Fetch review task with document context
  const { data: task } = await db.from('review_tasks')
    .select(`*, sp_dal_item_id, document_versions(
      id, file_name, doc_name, central_file_url, doc_unique_id,
      batches(id, batch_guid, controller_email, packages(package_name, package_code))
    )`)
    .eq('id', taskId).single()

  if (!task) return NextResponse.json({ error: 'Review task not found' }, { status: 404 })

  // Idempotency guard
  if (task.status === 'completed') {
    return NextResponse.json({ success: true, idempotent: true, outcomeCode: task.review_outcome_code })
  }

  // Verify caller is the assigned reviewer
  if (task.reviewer_email !== profile?.email) {
    return NextResponse.json({ error: 'You are not the assigned reviewer' }, { status: 403 })
  }

  const dv    = task.document_versions as any
  const batch = dv?.batches as any
  const batchId = batch?.id ?? task.batch_id
  const docUniqueId = dv?.doc_unique_id ?? ''
  const completedAt = new Date().toISOString()

  // Mark task complete in database
  const finalStatus = needMoreReview ? 'needs_more_review' : 'completed'
  await db.from('review_tasks').update({
    status:              finalStatus,
    review_outcome_code: needMoreReview ? null : outcomeCode,
    review_outcome_text: needMoreReview ? 'Needs More Review' : null,
    comment:             comment ?? null,
    date_completed:      completedAt,
    updated_at:          completedAt,
  }).eq('id', taskId)

  await logActivity({ area: 'reviews', action: 'review.submit', targetType: 'review_task', targetId: taskId, summary: needMoreReview ? 'needs more review' : outcomeCode, email: profile?.email })

  // ─── SharePoint write-back: update Document Approval List row ──────────────
  // Non-blocking — failure here does not affect new app workflow.
  // Uses stored sp_dal_item_id for a direct PATCH (no scan needed).
  if (!needMoreReview) {
    try {
      const spResult = await markApprovalListRowComplete(
        docUniqueId,
        task.reviewer_email,
        task.sequence_number,
        {
          reviewOutcomeCode: outcomeCode,
          comment:           comment ?? '',
          dateCompleted:     completedAt,
        },
        task.sp_dal_item_id ?? undefined
      )
      if (!spResult.ok) console.error('SP write-back failed on submit:', spResult.error)
    } catch (e: any) {
      console.error('SP write-back exception on submit:', e.message)
    }
  }

  // Audit
  await db.from('audit_events').insert({
    entity_type: 'review_task', entity_id: taskId,
    event_type:  finalStatus === 'completed' ? 'review_completed' : 'needs_more_review',
    actor_email: profile?.email,
    event_data:  { outcomeCode, comment },
  })

  if (needMoreReview) {
    await db.from('review_escalations').insert({
      batch_id:            batchId,
      document_version_id: task.document_version_id,
      reason:              comment ?? 'Reviewer requested additional review',
      status:              'open',
    })
    return NextResponse.json({ success: true, escalated: true })
  }

  // ─── Batch-level sequential advancement ────────────────────────────────────
  // The batch is the unit of work: a reviewer step covers EVERY document in the
  // batch, so we only advance to the next reviewer once the current step is fully
  // complete across all documents (mirrors start-review, which notifies per-batch).
  // This stops a downstream reviewer being activated/emailed for a document the
  // prior reviewer already cleared while they still have other documents open.
  const INCOMPLETE = ['pending', 'sent', 'opened', 'in_progress', 'overdue', 'needs_more_review']
  const currentSeq = task.sequence_number as number

  const { count: currentSeqRemaining } = await db.from('review_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('sequence_number', currentSeq)
    .in('status', INCOMPLETE)

  if ((currentSeqRemaining ?? 0) > 0) {
    // The current reviewer (or a co-reviewer at this step) still has documents to
    // review — hold here; the next reviewer stays 'pending' and is not notified.
    return NextResponse.json({ success: true, awaitingSequence: currentSeq })
  }

  // Current step done across all documents — find the next sequence still pending.
  const { data: nextPending } = await db.from('review_tasks')
    .select('sequence_number')
    .eq('batch_id', batchId)
    .eq('status', 'pending')
    .gt('sequence_number', currentSeq)
    .order('sequence_number', { ascending: true })
    .limit(1)
  const nextSeq = nextPending?.[0]?.sequence_number

  if (nextSeq != null) {
    // Activate ALL of the next step's tasks (every document), then email each next
    // reviewer ONCE with their full document list.
    const { data: nextTasks } = await db.from('review_tasks')
      .select('id, reviewer_email, document_version_id')
      .eq('batch_id', batchId)
      .eq('sequence_number', nextSeq)
      .eq('status', 'pending')

    const nextTaskIds = (nextTasks ?? []).map((t: any) => t.id)
    if (nextTaskIds.length) {
      await db.from('review_tasks').update({
        status: 'sent', date_sent: completedAt, updated_at: completedAt,
      }).in('id', nextTaskIds)
    }

    // Document metadata for the email + SP write-back
    const dvIds = [...new Set((nextTasks ?? []).map((t: any) => t.document_version_id))]
    const { data: dvs } = await db.from('document_versions')
      .select('id, file_name, doc_name, doc_unique_id').in('id', dvIds)
    const dvById: Record<string, any> = Object.fromEntries((dvs ?? []).map((d: any) => [d.id, d]))

    const { data: allTasks } = await db.from('review_tasks')
      .select('sequence_number').eq('batch_id', batchId)
    const totalReviewers = [...new Set((allTasks ?? []).map((t: any) => t.sequence_number))].length
    const packageName = batch?.packages?.package_name ?? 'Unknown'

    // One email per next reviewer, listing all their documents.
    const byReviewer = new Map<string, { taskId: string; dvId: string }[]>()
    for (const t of (nextTasks ?? [])) {
      if (!byReviewer.has(t.reviewer_email)) byReviewer.set(t.reviewer_email, [])
      byReviewer.get(t.reviewer_email)!.push({ taskId: t.id, dvId: t.document_version_id })
    }

    for (const [reviewerEmail, items] of byReviewer) {
      const documents = items.map((it) => ({
        fileName: dvById[it.dvId]?.file_name ?? '',
        docTitle: dvById[it.dvId]?.doc_name ?? dvById[it.dvId]?.file_name ?? '',
        taskId:   it.taskId,
      }))
      const firstTaskId = documents.find((d) => d.taskId)?.taskId ?? ''
      try {
        const html = batchReviewAssignedEmail({
          reviewerName: reviewerEmail,
          firstTaskId,
          packageName,
          documents,
          dueDate:      task.due_date ?? null,
          sequencePos:  nextSeq,
          totalReviewers,
          instructions: '',
        })
        await sendEmail({
          to:       reviewerEmail,
          subject:  `[Review Required] ${packageName} — ${documents.length} document${documents.length !== 1 ? 's' : ''}`,
          htmlBody: html,
        })
        await db.from('notification_logs').insert({
          batch_id: batchId, review_task_id: firstTaskId || null,
          to_email: reviewerEmail, template: 'review_assigned', status: 'sent',
          subject:  `[Review Required] ${packageName} — ${documents.length} documents`,
          sent_at:  completedAt,
        })
        for (const it of items) {
          const du = dvById[it.dvId]?.doc_unique_id
          if (du) await markApprovalListRowSent(du, reviewerEmail, nextSeq, completedAt)
        }
      } catch (e: any) {
        console.error('Next reviewer email failed:', e.message)
        await db.from('notification_logs').insert({
          batch_id: batchId, review_task_id: firstTaskId || null,
          to_email: reviewerEmail, template: 'review_assigned', status: 'failed',
          subject:  `[Review Required] ${packageName}`, error_message: e.message,
        })
      }
    }
    return NextResponse.json({ success: true, nextSequenceNotified: nextSeq, reviewers: [...byReviewer.keys()] })
  }

  // No more pending reviewers — check if all tasks for batch are done
  const { count: pendingCount } = await db.from('review_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .in('status', ['pending','sent','opened','in_progress'])

  if (pendingCount === 0) {
    // Determine worst-case outcome
    const { data: allCompleted } = await db.from('review_tasks')
      .select('review_outcome_code').eq('batch_id', batchId).eq('status', 'completed')
    const worstCode = (allCompleted ?? [])
      .map((t: any) => t.review_outcome_code)
      .filter(Boolean)
      .sort((a: string, b: string) => (OUTCOME_SEVERITY[b] ?? 0) - (OUTCOME_SEVERITY[a] ?? 0))[0] ?? 'A1'

    await db.from('batches').update({
      status:       'review_complete',
      completed_at: completedAt,
      updated_at:   completedAt,
    }).eq('id', batchId)

    // Notify controller — fall back to the configured Document Controller email
    // (system_settings 'doc_request_controller_email', default mornec@ppetech.co.za)
    // when the batch has none, so she's always told a batch is ready for transmittal.
    let controllerEmail: string | null = batch?.controller_email ?? null
    if (!controllerEmail || !controllerEmail.trim()) {
      const { data: dcSetting } = await db.from('system_settings')
        .select('value').eq('key', 'doc_request_controller_email').maybeSingle()
      controllerEmail = ((dcSetting as any)?.value as string | undefined)?.trim() || 'mornec@ppetech.co.za'
    }
    if (controllerEmail) {
      try {
        const emails = controllerEmail.split(/[;,]/).map((e: string) => e.trim()).filter(Boolean)
        const html = reviewCompleteEmail({
          batchId,
          packageName:      batch?.packages?.package_name ?? 'Unknown',
          finalOutcomeCode: worstCode,
          reviewerCount:    (allCompleted ?? []).length,
        })
        await sendEmail({
          to:      emails,
          subject: `[Review Complete] ${batch?.packages?.package_name} — ${worstCode}`,
          htmlBody: html,
        })
      } catch (e: any) { console.error('Controller notification failed:', e.message) }
    }
    return NextResponse.json({ success: true, allReviewsComplete: true, worstOutcome: worstCode })
  }

  return NextResponse.json({ success: true })
}
