import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { reviewAssignedEmail } from '@/lib/services/email-templates'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, email, full_name')
    .eq('auth_user_id', user.id).single()
  if (!['admin','document_controller'].includes(profile?.role ?? ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: batchId } = await params
  const body = await req.json()
  const { reviewers, dueDate, instructions } = body
  // reviewers: [{ email: string, name: string, sequenceNumber: number }]

  if (!reviewers?.length)
    return NextResponse.json({ error: 'At least one reviewer is required' }, { status: 400 })

  const db = createServiceClient()

  // Get batch + document_versions
  const { data: batch } = await db.from('batches')
    .select('id, batch_guid, status, vendor_id, package_id, packages(package_name, package_code), document_versions(id, file_name, doc_name, central_file_url)')
    .eq('id', batchId).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (batch.status === 'review_in_progress' || batch.status === 'review_complete')
    return NextResponse.json({ error: 'Review already started for this batch' }, { status: 400 })

  const docVersions = (batch.document_versions as any[]) ?? []
  if (!docVersions.length)
    return NextResponse.json({ error: 'No documents in this batch' }, { status: 400 })

  // Create review_tasks: one per reviewer × per document_version
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
        created_at:          new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      })
    }
  }

  const { error: insertErr } = await db.from('review_tasks').insert(taskInserts)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Update batch status
  await db.from('batches').update({
    status:     'review_in_progress',
    started_at: new Date().toISOString(),
    comments:   instructions ? `${batch.comments ?? ''}

Reviewer Instructions: ${instructions}`.trim() : batch.comments,
    updated_at: new Date().toISOString(),
  }).eq('id', batchId)

  // Send email to first reviewer (lowest sequence number) for each document
  const firstSeq = Math.min(...reviewers.map((r: any) => r.sequenceNumber))
  const firstReviewers = reviewers.filter((r: any) => r.sequenceNumber === firstSeq)

  for (const dv of docVersions) {
    for (const reviewer of firstReviewers) {
      // Mark task as sent
      await db.from('review_tasks')
        .update({ status: 'sent', date_sent: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('batch_id', batchId)
        .eq('document_version_id', dv.id)
        .eq('reviewer_email', reviewer.email)
        .eq('sequence_number', firstSeq)

      // Get review task ID for the link
      const { data: task } = await db.from('review_tasks')
        .select('id').eq('batch_id', batchId).eq('document_version_id', dv.id)
        .eq('reviewer_email', reviewer.email).eq('sequence_number', firstSeq).single()

      // Send email
      try {
        const html = reviewAssignedEmail({
          reviewerName:   reviewer.name || reviewer.email,
          reviewTaskId:   task?.id ?? '',
          packageName:    (batch.packages as any)?.package_name ?? 'Unknown',
          fileName:       dv.file_name,
          docTitle:       dv.doc_name ?? dv.file_name,
          dueDate:        dueDate ?? null,
          sequencePos:    firstSeq,
          totalReviewers: reviewers.length,
          instructions:   instructions ?? '',
          isManagerOverride: false,
        })
        await sendEmail({
          to:      reviewer.email,
          subject: `[Review Required] ${dv.doc_name ?? dv.file_name} — ${(batch.packages as any)?.package_name}`,
          htmlBody: html,
        })
        // Log notification
        await db.from('notification_logs').insert({
          batch_id:       batchId,
          review_task_id: task?.id ?? null,
          to_email:       reviewer.email,
          subject:        `[Review Required] ${dv.file_name}`,
          template:       'review_assigned',
          status:         'sent',
          sent_at:        new Date().toISOString(),
        })
      } catch (emailErr: any) {
        await db.from('notification_logs').insert({
          batch_id:       batchId,
          review_task_id: task?.id ?? null,
          to_email:       reviewer.email,
          subject:        `[Review Required] ${dv.file_name}`,
          template:       'review_assigned',
          status:         'failed',
          error_message:  emailErr.message,
        })
      }
    }
  }

  // Audit
  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batchId,
    event_type:  'review_started', actor_email: profile?.email,
    event_data:  { reviewers, dueDate, documentCount: docVersions.length },
  })

  return NextResponse.json({ success: true, tasksCreated: taskInserts.length })
}
