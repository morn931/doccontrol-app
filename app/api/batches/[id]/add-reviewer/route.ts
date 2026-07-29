import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { batchReviewAssignedEmail } from '@/lib/services/email-templates'

// Add a reviewer to a live batch — either a brand-new reviewer or a RE-REVIEW
// loop-back to someone who already reviewed (ruled 2026-07-28):
//   • Detour model: the new step is inserted immediately after the requester's
//     step; every open step after it shifts one later, so the LAST reviewer
//     (e.g. the engineering manager) always stays last.
//   • If the requester IS the last step (or has already completed), the new step
//     is inserted in front of the current step, whose armed tasks re-arm
//     afterwards — the flow detours and returns; drafts are preserved.
//   • Only allowed while the batch is still in progress.
const OPEN = ['pending', 'sent', 'opened', 'in_progress', 'overdue', 'needs_more_review']
const ARMED = ['sent', 'opened', 'in_progress']

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: batchId } = await params
  const { reviewerEmail, reviewerName, insertAfterSequence, reason } = await req.json()

  if (!reviewerEmail) return NextResponse.json({ error: 'Reviewer email required' }, { status: 400 })

  const db = createServiceClient()

  const { data: docVersions } = await db.from('document_versions')
    .select('id, file_name, doc_name').eq('batch_id', batchId)
  if (!docVersions?.length) return NextResponse.json({ error: 'No documents in batch' }, { status: 400 })

  const { data: allTasks } = await db.from('review_tasks')
    .select('id, reviewer_email, sequence_number, status, due_date')
    .eq('batch_id', batchId)
  const tasks = allTasks ?? []

  const openTasks = tasks.filter(t => OPEN.includes(t.status))
  if (!openTasks.length) {
    return NextResponse.json(
      { error: 'This review is already complete — re-review is only possible while the batch is in progress.' },
      { status: 409 })
  }
  const targetEmail = String(reviewerEmail).trim().toLowerCase()
  if (openTasks.some(t => (t.reviewer_email ?? '').toLowerCase() === targetEmail)) {
    return NextResponse.json(
      { error: 'That reviewer is already in the queue with an open review — they will see the document anyway.' },
      { status: 409 })
  }
  const isReReview = tasks.some(t => (t.reviewer_email ?? '').toLowerCase() === targetEmail)

  const activeSeq = Math.min(...openTasks.map(t => t.sequence_number))
  const requesterSeq = Number(insertAfterSequence) || activeSeq
  const hasLaterSteps = tasks.some(t => t.sequence_number > requesterSeq)

  // Detour insertion point (see header comment).
  let insertAt: number
  if (!hasLaterSteps) insertAt = requesterSeq              // requester is the last step → loop back in front of them
  else if (requesterSeq < activeSeq) insertAt = activeSeq  // requester already done → detour before the current step
  else insertAt = requesterSeq + 1                         // normal mid-chain: right after the requester
  // Uniqueness edge: the reviewer's own COMPLETED task can already sit at insertAt
  // (completed tasks never shift) — step past it, same semantics.
  while (tasks.some(t => (t.reviewer_email ?? '').toLowerCase() === targetEmail && t.sequence_number === insertAt)) {
    insertAt += 1
  }

  // Shift every OPEN task at insertAt or later one step down; armed tasks re-arm
  // (pending) so the engine re-notifies them when the detour returns. Completed
  // tasks keep their sequence — history stays intact. Shift from the highest
  // sequence down so the (doc, email, seq) uniqueness never collides mid-shift.
  const toShift = openTasks
    .filter(t => t.sequence_number >= insertAt)
    .sort((a, b) => b.sequence_number - a.sequence_number)
  for (const t of toShift) {
    const upd: Record<string, unknown> = { sequence_number: t.sequence_number + 1, updated_at: new Date().toISOString() }
    if (ARMED.includes(t.status)) upd.status = 'pending'
    await db.from('review_tasks').update(upd).eq('id', t.id)
  }

  // The new step is current if everything before it is closed → arm + email now;
  // otherwise it waits its turn and the submit engine arms it.
  const armNow = !tasks.some(t => t.sequence_number < insertAt && OPEN.includes(t.status))
  const nowIso = new Date().toISOString()
  const dueDate = tasks[0]?.due_date ?? null

  const newTasks = docVersions.map((dv: { id: string }) => ({
    batch_id:            batchId,
    document_version_id: dv.id,
    reviewer_email:      reviewerEmail,
    sequence_number:     insertAt,
    status:              armNow ? 'sent' : 'pending',
    due_date:            dueDate,
    created_at:          nowIso,
    updated_at:          nowIso,
  }))
  const { data: inserted, error } = await db.from('review_tasks').insert(newTasks).select('id, document_version_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (armNow && inserted?.length) {
    const { data: batch } = await db.from('batches').select('id, packages(package_name)').eq('id', batchId).single()
    const packageName = (batch as any)?.packages?.package_name ?? 'Unknown'
    const documents = inserted.map((t: any) => {
      const dv = docVersions.find(d => d.id === t.document_version_id)
      return { fileName: dv?.file_name ?? '', docTitle: dv?.doc_name ?? dv?.file_name ?? '', taskId: t.id }
    })
    try {
      await sendEmail({
        to: reviewerEmail,
        subject: `[Review Required] ${packageName} — ${documents.length} document${documents.length !== 1 ? 's' : ''}${isReReview ? ' (re-review)' : ''}`,
        htmlBody: batchReviewAssignedEmail({
          reviewerName: reviewerName || reviewerEmail,
          firstTaskId:  documents[0]?.taskId ?? '',
          packageName,
          documents,
          dueDate,
          sequencePos:  insertAt,
          totalReviewers: [...new Set([...tasks.map(t => t.sequence_number), insertAt])].length,
          instructions: reason ? `Re-review requested: ${reason}` : '',
        }),
      })
      await db.from('notification_logs').insert({
        batch_id: batchId, review_task_id: documents[0]?.taskId ?? null,
        to_email: reviewerEmail, template: 'review_assigned', status: 'sent',
        subject: `[Review Required] ${packageName} — ${documents.length} documents`,
        sent_at: nowIso,
      })
    } catch (e) {
      console.warn('add-reviewer notify failed', e)
    }
  }

  await db.from('review_escalations').insert({
    batch_id:    batchId,
    reason:      reason ?? `${isReReview ? 'Re-review' : 'Additional reviewer'}: ${reviewerEmail}`,
    status:      'open',
    created_at:  nowIso,
  })
  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batchId,
    event_type:  'reviewer_added',
    event_data:  { reviewerEmail, reviewerName, insertAfterSequence, newSeq: insertAt, isReReview, armNow, requestedBy: user.email },
  })

  return NextResponse.json({ success: true, sequenceNumber: insertAt, isReReview, armNow })
}
