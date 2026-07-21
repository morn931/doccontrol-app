import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { batchReviewAssignedEmail } from '@/lib/services/email-templates'
import { createApprovalListRow } from '@/lib/services/sharepoint-lists'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, email, full_name')
    .eq('auth_user_id', user.id).single()
  if (!['admin','document_controller','developer'].includes(profile?.role ?? ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: batchId } = await params
  const body = await req.json()
  const { reviewers, dueDate, instructions } = body

  if (!reviewers?.length)
    return NextResponse.json({ error: 'At least one reviewer is required' }, { status: 400 })

  const db = createServiceClient()

  const { data: batch } = await db.from('batches')
    .select(`id, batch_guid, status, vendor_id, package_id, target_library, controller_email,
             packages(package_name, package_code), vendors(name),
             document_versions(id, file_name, doc_name, doc_unique_id, central_file_url,
                              discipline, document_type, topic, ai_text)`)
    .eq('id', batchId).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (['review_in_progress','review_complete'].includes(batch.status))
    return NextResponse.json({ error: 'Review already started' }, { status: 400 })

  const docVersions = (batch.document_versions as any[]) ?? []
  if (!docVersions.length)
    return NextResponse.json({ error: 'No documents in this batch' }, { status: 400 })

  const packageName = (batch.packages as any)?.package_name ?? 'Unknown'
  const vendorName  = (batch.vendors as any)?.name ?? 'Unknown'

  // ─── Create review_tasks in database ──────────────────────────────────────
  // One row per document per reviewer, sequence as chosen by controller
  const taskInserts: any[] = []
  for (const dv of docVersions) {
    for (const reviewer of reviewers) {
      taskInserts.push({
        batch_id:            batchId,
        document_version_id: dv.id,
        reviewer_email:      reviewer.email,
        sequence_number:     reviewer.sequenceNumber,
        status:              'pending',
        due_date:            dueDate ?? null,
      })
    }
  }

  const { error: insertErr } = await db.from('review_tasks').insert(taskInserts)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Fetch inserted task IDs so we can store SP list item IDs after creation
  const { data: insertedTasks } = await db.from('review_tasks')
    .select('id, document_version_id, reviewer_email, sequence_number')
    .eq('batch_id', batchId)
  const taskLookup: Record<string, string> = {}
  for (const t of insertedTasks ?? []) {
    taskLookup[`${t.document_version_id}:${t.reviewer_email}:${t.sequence_number}`] = t.id
  }

  // Update batch status
  await db.from('batches').update({
    status:     'review_in_progress',
    started_at: new Date().toISOString(),
    comments:   instructions
      ? `${(batch as any).comments ?? ''}

Reviewer Instructions: ${instructions}`.trim()
      : (batch as any).comments,
    updated_at: new Date().toISOString(),
  }).eq('id', batchId)

  // ─── SharePoint write-back: create Document Approval List rows ─────────────
  // One row per reviewer per document — matches old system structure exactly.
  // Non-blocking: new app workflow continues even if SP write fails.
  const spErrors: string[] = []
  const sortedReviewers = [...reviewers].sort((a: any, b: any) => a.sequenceNumber - b.sequenceNumber)

  for (const dv of docVersions) {
    for (const reviewer of sortedReviewers) {
      const result = await createApprovalListRow({
        fileName:       dv.file_name,
        approverEmail:  reviewer.email,
        sequenceNumber: reviewer.sequenceNumber,
        batchGuid:      batch.batch_guid,
        docUniqueId:    dv.doc_unique_id ?? '',
        docUrl:         dv.central_file_url ?? '',
        libraryName:    (batch as any).target_library ?? null,
        vendorSite:     vendorName,
        dueDate:        dueDate ?? null,
        docName:        dv.doc_name ?? null,
        discipline:     dv.discipline ?? null,
        documentType:   dv.document_type ?? null,
        topic:          dv.topic ?? null,
        aiText:         dv.ai_text ?? null,
      })
      if (!result.ok) {
        spErrors.push(`${reviewer.email}/${dv.file_name}: ${result.error}`)
      } else if (result.itemId) {
        // Store SP list item ID so submit route can PATCH directly (no scan needed)
        const taskId = taskLookup[`${dv.id}:${reviewer.email}:${reviewer.sequenceNumber}`]
        if (taskId) {
          await db.from('review_tasks').update({ sp_dal_item_id: result.itemId }).eq('id', taskId)
        }
      }
    }
  }

  // ─── Send ONE batch email per first reviewer (all documents listed) ──────────
  const firstSeq = Math.min(...reviewers.map((r: any) => r.sequenceNumber))
  const firstReviewers = reviewers.filter((r: any) => r.sequenceNumber === firstSeq)
  const totalReviewers = reviewers.length
  const sentAt = new Date().toISOString()

  // Mark all first-reviewer tasks as 'sent'
  for (const dv of docVersions) {
    for (const reviewer of firstReviewers) {
      await db.from('review_tasks').update({
        status: 'sent', date_sent: sentAt, updated_at: sentAt,
      }).eq('batch_id', batchId).eq('document_version_id', dv.id)
        .eq('reviewer_email', reviewer.email).eq('sequence_number', firstSeq)
    }
  }

  // Send ONE email per reviewer with all documents listed
  for (const reviewer of firstReviewers) {
    // Collect all tasks for this reviewer so we have the task IDs
    const { data: reviewerTasks } = await db.from('review_tasks')
      .select('id, document_version_id')
      .eq('batch_id', batchId).eq('reviewer_email', reviewer.email).eq('sequence_number', firstSeq)

    const tasksByDvId = Object.fromEntries((reviewerTasks ?? []).map((t: any) => [t.document_version_id, t.id]))

    const documents = docVersions.map((dv: any) => ({
      fileName: dv.file_name,
      docTitle: dv.doc_name ?? dv.file_name,
      taskId:   tasksByDvId[dv.id] ?? '',
    }))

    const firstTaskId = documents.find(d => d.taskId)?.taskId ?? ''

    try {
      const html = batchReviewAssignedEmail({
        reviewerName:   reviewer.name || reviewer.email,
        firstTaskId,
        packageName,
        documents,
        dueDate:        dueDate ?? null,
        sequencePos:    firstSeq,
        totalReviewers,
        instructions:   instructions ?? '',
      })
      await sendEmail({
        to:       reviewer.email,
        subject:  `[Review Required] ${packageName} — ${documents.length} document${documents.length !== 1 ? 's' : ''}`,
        htmlBody: html,
      })
      await db.from('notification_logs').insert({
        batch_id: batchId, review_task_id: firstTaskId || null,
        to_email: reviewer.email, template: 'review_assigned', status: 'sent',
        subject:  `[Review Required] ${packageName} — ${documents.length} documents`,
        sent_at:  sentAt,
      })
    } catch (emailErr: any) {
      await db.from('notification_logs').insert({
        batch_id: batchId, review_task_id: firstTaskId || null,
        to_email: reviewer.email, template: 'review_assigned', status: 'failed',
        subject:  `[Review Required] ${packageName} — ${documents.length} documents`,
        error_message: emailErr.message,
      })
    }
  }

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batchId,
    event_type: 'review_started', actor_email: profile?.email,
    event_data: { reviewers, dueDate, documentCount: docVersions.length, spErrors },
  })

  return NextResponse.json({
    success:      true,
    tasksCreated: taskInserts.length,
    // Return SP errors in response so controller can see if sync failed
    spSyncErrors: spErrors.length > 0 ? spErrors : undefined,
  })
}
