/**
 * POST /api/batches/[id]/signoff/reset — controller-only.
 * Un-does a sign-off so it can be sent again: reverts the batch to 'review_complete', clears the
 * sign-off pointers, and removes the sign-off tasks. The next "Send for sign-off" regenerates a
 * fresh PDF/base. For internal documents whose sign-off is in progress, complete, or declined.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const RESETTABLE = ['signoff_in_progress', 'signed', 'signoff_declined']

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_START_SIGNOFF, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Only a sign-off controller can reset a sign-off.' }, { status: 403 })

  const { id } = await params
  const db = createServiceClient()
  const { data: batch } = await db.from('batches').select('id, source, status, internal_ref').eq('id', id).single()
  const b = batch as any
  if (!b) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (!['internal', 'internal_review'].includes(b.source))
    return NextResponse.json({ error: 'Sign-off reset applies to internal documents only.' }, { status: 400 })
  if (!RESETTABLE.includes(b.status))
    return NextResponse.json({ error: `Nothing to reset — this batch has no active sign-off (status: ${b.status}).` }, { status: 400 })

  const now = new Date().toISOString()
  await db.from('signoff_tasks').delete().eq('batch_id', id)
  await db.from('batches').update({
    status: 'review_complete',
    signoff_pdf_url: null, signoff_base_url: null, signoff_started_at: null, signed_at: null,
    updated_at: now,
  }).eq('id', id)

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: id, event_type: 'signoff_reset',
    actor_user_id: profile?.id ?? null, actor_email: profile?.email ?? null,
    event_data: { from: b.status, internalRef: b.internal_ref },
  })

  return NextResponse.json({ ok: true })
}
