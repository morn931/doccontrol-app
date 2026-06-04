import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { reviewAssignedEmail, reviewCompleteEmail } from '@/lib/services/email-templates'

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

  // Fetch the review task
  const { data: task } = await db.from('review_tasks')
    .select('*, document_versions(id, file_name, doc_name, central_file_url, batch_id, batches(id, batch_guid, packages(package_name, package_code)))')
    .eq('id', taskId).single()

  if (!task) return NextResponse.json({ error: 'Review task not found' }, { status: 404 })

  // Idempotency guard — if already completed, return success without side effects
  if (task.status === 'completed') {
    return NextResponse.json({ success: true, idempotent: true, outcomeCode: task.review_outcome_code })
  }

  // Verify the caller is the assigned reviewer
  if (task.reviewer_email !== profile?.email) {
    return NextResponse.json({ error: 'You are not the assigned reviewer for this task' }, { status: 403 })
  }

  const dv = task.document_versions as any
  const batch = dv?.batches as any
  const batchId = batch?.id ?? task.batch_id

  // Mark task as completed
  const finalStatus = needMoreReview ? 'needs_more_review' : 'completed'
  await db.from('review_tasks').update({
    status:              finalStatus,
    review_outcome_code: needMoreReview ? null : outcomeCode,
    review_outcome_text: needMoreReview ? 'Needs More Review' : null,
    comment:             comment ?? null,
    date_completed:      new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  }).eq('id', taskId)

  // Audit
  await db.from('audit_events').insert({
    entity_type: 'review_task', entity_id: taskId,
    event_type:  finalStatus === 'completed' ? 'review_completed' : 'needs_more_review',
    actor_email: profile?.email,
    event_data:  { outcomeCode, comment },
  })

  if (needMoreReview) {
    // Create escalation record
    await db.from('review_escalations').insert({
      batch_id:            batchId,
      document_version_id: task.document_version_id,
      requested_by:        null,
      reason:              comment ?? 'Reviewer requested additional review',
      status:              'open',
    })
    return NextResponse.json({ success: true, escalated: true })
  }

  // Find next pending reviewer for this document (same batch, higher sequence number)
  const { data: nextTasks } = await db.from('review_tasks')
    .select('id, reviewer_email, sequence_number, batch_id')
    .eq('document_version_id', task.document_version_id)
    .eq('status', 'pending')
    .order('sequence_number', { ascending: true })
    .limit(1)

  const nextTask = nextTasks?.[0]

  if (nextTask) {
    // Activate next reviewer
    await db.from('review_tasks').update({
      status:    'sent',
      date_sent: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', nextTask.id)

    // Send email to next reviewer
    try {
      // Get reviewer details
      const { data: allTasks } = await db.from('review_tasks')
        .select('sequence_number').eq('document_version_id', task.document_version_id)
      const totalReviewers = [...new Set((allTasks ?? []).map((t: any) => t.sequence_number))].length

      const html = reviewAssignedEmail({
        reviewerName:   nextTask.reviewer_email,
        reviewTaskId:   nextTask.id,
        packageName:    batch?.packages?.package_name ?? 'Unknown',
        fileName:       dv?.file_name ?? '',
        docTitle:       dv?.doc_name ?? dv?.file_name ?? '',
        dueDate:        task.due_date ?? null,
        sequencePos:    nextTask.sequence_number,
        totalReviewers,
        instructions:   '',
        isManagerOverride: false,
      })
      await sendEmail({
        to:       nextTask.reviewer_email,
        subject:  `[Review Required] ${dv?.doc_name ?? dv?.file_name} — ${batch?.packages?.package_name}`,
        htmlBody: html,
      })
      await db.from('notification_logs').insert({
        batch_id: nextTask.batch_id, review_task_id: nextTask.id,
        to_email: nextTask.reviewer_email, template: 'review_assigned', status: 'sent',
        subject: `[Review Required] ${dv?.file_name}`, sent_at: new Date().toISOString(),
      })
    } catch (e: any) {
      await db.from('notification_logs').insert({
        batch_id: nextTask.batch_id, review_task_id: nextTask.id,
        to_email: nextTask.reviewer_email, template: 'review_assigned', status: 'failed',
        subject: `[Review Required] ${dv?.file_name}`, error_message: e.message,
      })
    }
    return NextResponse.json({ success: true, nextReviewerNotified: nextTask.reviewer_email })
  }

  // No more pending reviewers — check if all tasks for this batch are done
  const { count: pendingCount } = await db.from('review_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .in('status', ['pending','sent','opened','in_progress'])

  if (pendingCount === 0) {
    // All reviews complete — determine worst outcome and notify controller
    const { data: allCompleted } = await db.from('review_tasks')
      .select('review_outcome_code').eq('batch_id', batchId).eq('status', 'completed')

    const worstCode = (allCompleted ?? [])
      .map((t: any) => t.review_outcome_code)
      .filter(Boolean)
      .sort((a: string, b: string) => (OUTCOME_SEVERITY[b] ?? 0) - (OUTCOME_SEVERITY[a] ?? 0))[0] ?? 'A1'

    await db.from('batches').update({
      status: 'review_complete', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', batchId)

    // Notify controller
    const { data: batchFull } = await db.from('batches')
      .select('controller_email, packages(package_name)').eq('id', batchId).single()
    const controllerEmail = (batchFull as any)?.controller_email
    if (controllerEmail) {
      try {
        const emails = controllerEmail.split(/[;,]/).map((e: string) => e.trim()).filter(Boolean)
        const html = reviewCompleteEmail({
          batchId, packageName: (batchFull as any)?.packages?.package_name ?? 'Unknown',
          finalOutcomeCode: worstCode,
          reviewerCount: (allCompleted ?? []).length,
        })
        await sendEmail({ to: emails, subject: `[Review Complete] ${(batchFull as any)?.packages?.package_name} — ${worstCode}`, htmlBody: html })
      } catch (e: any) { console.error('Controller notification failed:', e.message) }
    }

    return NextResponse.json({ success: true, allReviewsComplete: true, worstOutcome: worstCode })
  }

  return NextResponse.json({ success: true })
}
