/**
 * POST /api/batches/[id]/signoff-only/clear
 *
 * The Document Controller clears a sign-off-only REQUEST — the document then goes through the
 * normal review instead. Only clears a pending request; it does not undo an already-approved
 * skip (once at review_complete + signoff_only, the doc has left the review path). Gated by
 * ACTION_APPROVE_SIGNOFF_ONLY.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_APPROVE_SIGNOFF_ONLY, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = createServiceClient()
  const { data: batch } = await db.from('batches').select('id, signoff_only, signoff_only_requested_by').eq('id', id).single()
  const b = batch as { signoff_only?: boolean; signoff_only_requested_by?: string | null } | null
  if (!b) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (b.signoff_only)
    return NextResponse.json({ error: 'This document was already sent straight to sign-off; it can no longer be cleared to review.' }, { status: 400 })

  const now = new Date().toISOString()
  await db.from('batches').update({
    signoff_only_requested_by: null, signoff_only_requested_at: null, signoff_only_reason: null, updated_at: now,
  }).eq('id', id)

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: id, event_type: 'signoff_only_cleared',
    actor_user_id: profile?.id ?? null, actor_email: profile?.email ?? null,
    event_data: { requestedBy: b.signoff_only_requested_by ?? null },
  })

  return NextResponse.json({ success: true, batchId: id })
}
