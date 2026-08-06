import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { batchReviewAssignedEmail } from '@/lib/services/email-templates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Maintenance: re-arm demotion-stuck review chains.
 *
 * The legacy SharePoint Approval-List sync used to demote an active reviewer's task
 * back to 'pending' and clear its date_sent (fixed in lib/import/process.ts, 2026-08-06).
 * A chain left in that state is silently dead: every earlier reviewer is completed, but
 * the next reviewer sits 'pending'+unsent with nobody armed, and the reminder cron only
 * chases ARMED tasks — so it never self-heals.
 *
 * This endpoint finds that exact signature, re-arms the current step (pending → sent),
 * and emails each stuck reviewer the normal "Review Required" message. Idempotent: a
 * batch with anyone already armed is skipped. Gated by CRON_SECRET. ?dry=1 to preview.
 */
const ARMED = ['sent', 'opened', 'in_progress', 'overdue']

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const dry = url.searchParams.get('dry') === '1'

  const db = createServiceClient()
  const { data: batches } = await db.from('batches')
    .select('id, packages(package_name)')
    .eq('status', 'review_in_progress')
    .limit(1000)

  const actions: any[] = []

  for (const b of batches ?? []) {
    const batchId = b.id
    const { data: tasks } = await db.from('review_tasks')
      .select('id, reviewer_email, sequence_number, status, date_sent, document_version_id')
      .not('batch_id', 'is', null)
      .eq('batch_id', batchId)
    if (!tasks?.length) continue

    const seqs = [...new Set(tasks.map(t => t.sequence_number))].sort((a, c) => a - c)
    const seqDone = (s: number) => tasks.filter(t => t.sequence_number === s).every(t => t.status === 'completed')
    const firstOpen = seqs.find(s => !seqDone(s))
    if (firstOpen == null || firstOpen <= 1) continue

    const earlierAllDone = seqs.filter(s => s < firstOpen).every(seqDone)
    const stepRows = tasks.filter(t => t.sequence_number === firstOpen && t.status !== 'completed')
    const allPendingUnsent = stepRows.every(t => t.status === 'pending' && !t.date_sent)
    const anyArmed = tasks.some(t => ARMED.includes(t.status))
    if (!(earlierAllDone && allPendingUnsent && !anyArmed)) continue

    // ── Demotion-stuck. Re-arm this step + email each reviewer at it. ──
    const nowIso = new Date().toISOString()
    const totalReviewers = seqs.length
    const packageName = (b.packages as any)?.package_name ?? 'Unknown'
    const dvIds = [...new Set(stepRows.map(t => t.document_version_id))]
    const { data: dvs } = await db.from('document_versions')
      .select('id, file_name, doc_name').in('id', dvIds)
    const dvById: Record<string, any> = Object.fromEntries((dvs ?? []).map((d: any) => [d.id, d]))

    if (!dry) {
      await db.from('review_tasks')
        .update({ status: 'sent', date_sent: nowIso, updated_at: nowIso })
        .in('id', stepRows.map(t => t.id))
    }

    // one email per reviewer at this step, listing their documents
    const byReviewer = new Map<string, { taskId: string; dvId: string }[]>()
    for (const t of stepRows) {
      if (!byReviewer.has(t.reviewer_email)) byReviewer.set(t.reviewer_email, [])
      byReviewer.get(t.reviewer_email)!.push({ taskId: t.id, dvId: t.document_version_id })
    }

    const emailed: string[] = []
    for (const [reviewerEmail, items] of byReviewer) {
      const documents = items.map(it => ({
        fileName: dvById[it.dvId]?.file_name ?? '',
        docTitle: dvById[it.dvId]?.doc_name ?? dvById[it.dvId]?.file_name ?? '',
        taskId:   it.taskId,
      }))
      const firstTaskId = documents.find(d => d.taskId)?.taskId ?? ''
      if (dry) { emailed.push(reviewerEmail); continue }
      try {
        await sendEmail({
          to: reviewerEmail,
          subject: `[Review Required] ${packageName} — ${documents.length} document${documents.length !== 1 ? 's' : ''}`,
          htmlBody: batchReviewAssignedEmail({
            reviewerName: reviewerEmail, firstTaskId, packageName, documents,
            dueDate: null, sequencePos: firstOpen, totalReviewers, instructions: '',
          }),
        })
        await db.from('notification_logs').insert({
          batch_id: batchId, review_task_id: firstTaskId || null,
          to_email: reviewerEmail, template: 'review_assigned', status: 'sent',
          subject: `[Review Required] ${packageName} — ${documents.length} documents`, sent_at: nowIso,
        })
        emailed.push(reviewerEmail)
      } catch (e: any) {
        await db.from('notification_logs').insert({
          batch_id: batchId, review_task_id: firstTaskId || null,
          to_email: reviewerEmail, template: 'review_assigned', status: 'failed',
          subject: `[Review Required] ${packageName}`, error_message: e?.message ?? String(e),
        })
      }
    }

    if (!dry) {
      await db.from('audit_events').insert({
        entity_type: 'batch', entity_id: batchId, event_type: 'review_step_rearmed',
        actor_email: 'system_rearm_stuck',
        event_data: { sequence: firstOpen, reviewers: emailed, reason: 'demotion-stuck recovery' },
      })
    }

    actions.push({ batchId, package: packageName, sequence: firstOpen, rearmed: stepRows.length, emailed })
  }

  return NextResponse.json({ ok: true, dry, stuckBatches: actions.length, actions })
}
