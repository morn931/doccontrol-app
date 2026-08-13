import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { OUTCOME_CODES, worstOutcome, type OutcomeCode } from '@/lib/utils/outcome-codes'
import { logActivity } from '@/lib/activity'

/**
 * POST /api/batches/[id]/amend-outcome
 *
 * Correct a reviewer's submitted outcome code after the fact (e.g. Eric picked B2 when he
 * meant A1). A review normally locks once completed — the submit route is idempotent — so
 * before this there was no way to fix a mis-click. Gated to the Document Controller
 * (same permission as issuing a transmittal); every amendment carries a required reason and
 * is written to the audit trail.
 *
 * It updates the task's code, recomputes the batch's overall (worst-case) outcome, and — if a
 * transmittal already exists whose final code no longer matches — corrects that transmittal
 * record and flags that a corrected transmittal should be re-issued to the vendor. It never
 * re-sends to the vendor itself; that stays a deliberate Doc-Control action.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_GENERATE_TRANSMITTAL, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Only the Document Controller can amend a review outcome.' }, { status: 403 })

  const { id: batchId } = await params
  const { taskId, newCode, reason } = await req.json()
  if (!taskId || !newCode) return NextResponse.json({ error: 'taskId and newCode are required.' }, { status: 400 })
  if (!(newCode in OUTCOME_CODES)) return NextResponse.json({ error: `Unknown outcome code "${newCode}".` }, { status: 400 })
  if (!String(reason ?? '').trim()) return NextResponse.json({ error: 'A reason for the amendment is required.' }, { status: 400 })

  const db = createServiceClient()

  const { data: task } = await db.from('review_tasks')
    .select('id, batch_id, reviewer_email, review_outcome_code, status')
    .eq('id', taskId).single()
  if (!task || task.batch_id !== batchId)
    return NextResponse.json({ error: 'Review task not found on this batch.' }, { status: 404 })
  if (task.status !== 'completed')
    return NextResponse.json({ error: 'Only a completed review can be amended.' }, { status: 400 })

  const oldCode = task.review_outcome_code as string | null
  if (oldCode === newCode) return NextResponse.json({ success: true, unchanged: true })

  const nowIso = new Date().toISOString()
  await db.from('review_tasks').update({
    review_outcome_code: newCode,
    review_outcome_text: (OUTCOME_CODES as any)[newCode].text,
    updated_at: nowIso,
  }).eq('id', taskId)

  // Recompute the batch's overall (worst-case) outcome across all completed reviews.
  const { data: completed } = await db.from('review_tasks')
    .select('review_outcome_code').eq('batch_id', batchId).eq('status', 'completed')
  const codes = (completed ?? []).map((t: any) => t.review_outcome_code).filter(Boolean) as OutcomeCode[]
  const batchWorst = worstOutcome(codes) ?? 'A1'

  // If a transmittal already exists and its final code no longer matches, correct the record
  // and flag it for re-issue. We never auto-send to the vendor.
  const { data: trs } = await db.from('transmittals')
    .select('id, transmittal_number, final_outcome_code, returned_to_vendor_at')
    .eq('batch_id', batchId).order('generated_at', { ascending: false }).limit(1)
  const transmittal = trs?.[0]
  let transmittalNeedsReissue = false
  if (transmittal && transmittal.final_outcome_code !== batchWorst) {
    await db.from('transmittals').update({
      final_outcome_code: batchWorst,
      final_outcome_text: (OUTCOME_CODES as any)[batchWorst].text,
    }).eq('id', transmittal.id)
    transmittalNeedsReissue = true
  }

  await db.from('audit_events').insert({
    entity_type: 'review_task', entity_id: taskId, event_type: 'outcome_amended',
    actor_email: profile?.email ?? null,
    event_data: {
      batchId, reviewer: task.reviewer_email, from: oldCode, to: newCode, reason: String(reason).trim(),
      batchWorst, transmittal: transmittal?.transmittal_number ?? null, transmittalNeedsReissue,
    },
  })
  await logActivity({
    area: 'reviews', action: 'review.amend_outcome', targetType: 'review_task', targetId: taskId,
    summary: `${task.reviewer_email}: ${oldCode ?? '—'} → ${newCode} (batch now ${batchWorst})`,
    email: profile?.email ?? undefined,
  })

  return NextResponse.json({
    success: true, oldCode, newCode, batchWorst,
    transmittalNeedsReissue, transmittalNumber: transmittal?.transmittal_number ?? null,
    vendorAlreadyReturned: !!transmittal?.returned_to_vendor_at,
  })
}
