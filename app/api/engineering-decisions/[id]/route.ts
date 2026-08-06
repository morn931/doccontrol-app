import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function ctx(db: any, authUserId: string) {
  const { data: p } = await db.from('users').select('role, email, eng_action_manager').eq('auth_user_id', authUserId).single()
  if (!p) return { email: null, isMgr: false }
  const { data: rd } = await db.from('role_definitions').select('eng_action_manager').eq('role', (p as any).role).maybeSingle()
  // Role flag OR the per-person override (migration 039).
  return { email: (p as any).email as string, isMgr: !!(rd as any)?.eng_action_manager || !!(p as any).eng_action_manager }
}

// PATCH — the approval control loop + edits. Allowed for the Decision Owner/Approver OR the
// Engineering Manager (override). Approve/reject stamps who + when.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const db = createServiceClient()
  const me = await ctx(db, user.id)
  const { id } = await params
  const { data: dec } = await db.from('engineering_decision').select('owner_email').eq('id', id).single()
  if (!dec) return NextResponse.json({ error: 'Decision not found.' }, { status: 404 })
  const isOwner = me.email && (dec as any).owner_email && me.email.toLowerCase() === String((dec as any).owner_email).toLowerCase()
  if (!me.isMgr && !isOwner)
    return NextResponse.json({ error: 'Only the Decision Owner/Approver or the Engineering Manager can update this decision.' }, { status: 403 })

  const b = await req.json().catch(() => ({} as any))
  const patch: any = { updated_at: new Date().toISOString() }
  const STAT = ['pending_approval', 'approved', 'rejected', 'on_hold', 'superseded', 'closed']
  for (const [k, col] of [['title', 'title'], ['background', 'background'], ['optionsConsidered', 'options_considered'],
    ['decisionMade', 'decision_made'], ['rationale', 'rationale'], ['relatedDocuments', 'related_documents'], ['comments', 'comments']] as const)
    if (b[k] !== undefined) patch[col] = b[k]
  for (const [k, col] of [['costImpact', 'cost_impact'], ['scheduleImpact', 'schedule_impact'], ['safetyImpact', 'safety_impact']] as const)
    if (b[k] !== undefined) patch[col] = ['none', 'low', 'medium', 'high'].includes(b[k]) ? b[k] : null
  if (b.priority !== undefined) patch.priority = ['low', 'medium', 'high', 'critical'].includes(b.priority) ? b.priority : null
  if (b.dueDate !== undefined) patch.due_date = b.dueDate || null
  if (b.status !== undefined) {
    if (!STAT.includes(b.status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    patch.status = b.status
    if (b.status === 'approved' || b.status === 'rejected') { patch.approved_by_email = me.email; patch.approved_at = new Date().toISOString() }
    if (['approved', 'rejected', 'closed', 'superseded'].includes(b.status)) patch.date_closed = new Date().toISOString().slice(0, 10)
    if (b.status === 'pending_approval' || b.status === 'on_hold') { patch.date_closed = null }
  }
  const { data: updated, error } = await db.from('engineering_decision').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, decision: updated })
}

// DELETE — Engineering-Manager-only.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const db = createServiceClient()
  const me = await ctx(db, user.id)
  if (!me.isMgr) return NextResponse.json({ error: 'Only the Engineering Manager can delete decisions.' }, { status: 403 })
  const { id } = await params
  const { error } = await db.from('engineering_decision').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
