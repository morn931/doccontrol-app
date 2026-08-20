/**
 * POST /api/batches/[id]/signoff-only/approve
 *
 * The Document Controller flags an internal document STRAIGHT TO SIGN-OFF, skipping the
 * CoreDocs review cycle — for a revision returned from Aconex that was already reviewed.
 * Sets the batch to `review_complete` (the sign-off gate's entry point) and stamps who/why.
 * Works whether the owner raised a request or the DC flags it directly. Gated by
 * ACTION_APPROVE_SIGNOFF_ONLY (Document Controller / admin / developer).
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'

// States from which review may still be skipped. Past sign-off (signoff_in_progress / signed /
// issued) it's too late; rejected/cancelled are dead ends.
const SKIPPABLE = ['metadata_pending', 'review_ready_to_start', 'review_in_progress', 'review_complete']

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_APPROVE_SIGNOFF_ONLY, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const reason = String(body?.reason ?? '').trim() || 'Returned from Aconex for revision — already reviewed.'

  const db = createServiceClient()
  const { data: batch } = await db.from('batches')
    .select('id, source, status, signoff_only_reason, request_line_id').eq('id', id).single()
  const b = batch as { source?: string; status?: string; signoff_only_reason?: string | null } | null
  if (!b) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (!['internal', 'internal_review'].includes(b.source ?? ''))
    return NextResponse.json({ error: 'Sign-off only applies to internal documents.' }, { status: 400 })
  if (!SKIPPABLE.includes(b.status ?? ''))
    return NextResponse.json({ error: `This document is past the point where review can be skipped (status: ${b.status}).` }, { status: 400 })

  const now = new Date().toISOString()
  await db.from('batches').update({
    status: 'review_complete',
    signoff_only: true,
    signoff_only_reason: b.signoff_only_reason ?? reason,
    signoff_only_approved_by: profile?.email ?? null,
    signoff_only_approved_at: now,
    updated_at: now,
  }).eq('id', id)

  // Review is being skipped — drop any not-yet-complete review tasks so they don't linger in a
  // reviewer's queue (best-effort; only when we weren't already at a genuine review_complete).
  if (b.status !== 'review_complete') {
    try { await db.from('review_tasks').delete().eq('batch_id', id) } catch { /* non-fatal */ }
  }

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: id, event_type: 'signoff_only_approved',
    actor_user_id: profile?.id ?? null, actor_email: profile?.email ?? null,
    event_data: { reason: b.signoff_only_reason ?? reason, fromStatus: b.status },
  })

  return NextResponse.json({ success: true, batchId: id, status: 'review_complete' })
}
