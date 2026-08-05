import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'

export const dynamic = 'force-dynamic'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

// Does this user carry the eng_action_manager capability? (engineering_manager / admin /
// developer by default — migration 036 flag, tunable in role_definitions.)
async function isEngManager(db: any, authUserId: string): Promise<{ ok: boolean; email: string | null }> {
  const { data: p } = await db.from('users').select('role, email').eq('auth_user_id', authUserId).single()
  if (!p) return { ok: false, email: null }
  const { data: rd } = await db.from('role_definitions').select('eng_action_manager').eq('role', (p as any).role).maybeSingle()
  return { ok: !!(rd as any)?.eng_action_manager, email: (p as any).email ?? null }
}

// PATCH — Engineering-Manager-only: set priority / status / due date / close-with-comment.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const db = createServiceClient()
  const mgr = await isEngManager(db, user.id)
  if (!mgr.ok) return NextResponse.json({ error: 'Only the Engineering Manager can manage actions.' }, { status: 403 })

  const { id } = await params
  const b = await req.json().catch(() => ({} as any))
  const patch: any = { updated_at: new Date().toISOString() }
  if (b.priority !== undefined) patch.priority = ['low', 'medium', 'high'].includes(b.priority) ? b.priority : null
  if (b.dueDate !== undefined) patch.due_date = b.dueDate || null
  if (b.status !== undefined) {
    if (!['open', 'in_progress', 'closed', 'dismissed'].includes(b.status))
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    patch.status = b.status
    if (b.status === 'closed' || b.status === 'dismissed') {
      patch.closed_at = new Date().toISOString()
      patch.closed_by_email = mgr.email
      if (b.closeoutComment) patch.closeout_comment = String(b.closeoutComment).trim()
    } else { patch.closed_at = null; patch.closed_by_email = null }
  }

  const { data: updated, error } = await db.from('engineering_action').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify the raiser when their action is closed/dismissed (loop closed).
  if ((patch.status === 'closed' || patch.status === 'dismissed') && (updated as any)?.raised_by_email) {
    try {
      await sendMail({
        to: [(updated as any).raised_by_email],
        subject: `Engineering action ${patch.status} — ${(updated as any).action_ref}`,
        htmlBody: brandedEmail({
          heading: `Your action was ${patch.status}`,
          bodyHtml: `<p><b>${(updated as any).action_ref}</b>${(updated as any).document_number ? ` (${(updated as any).document_number})` : ''} — “${(updated as any).description}” — was marked <b>${patch.status}</b> by the Engineering Manager.</p>
            ${patch.closeout_comment ? `<p style="padding:8px 12px;border-left:3px solid #059669;background:#ecfdf5">${patch.closeout_comment}</p>` : ''}`,
          cta: { href: `${APP_URL}/engineering-actions`, label: 'Open the register →' },
        }),
      })
    } catch {}
  }
  return NextResponse.json({ ok: true, action: updated })
}

// DELETE — Engineering-Manager-only.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const db = createServiceClient()
  const mgr = await isEngManager(db, user.id)
  if (!mgr.ok) return NextResponse.json({ error: 'Only the Engineering Manager can delete actions.' }, { status: 403 })
  const { id } = await params
  const { error } = await db.from('engineering_action').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
