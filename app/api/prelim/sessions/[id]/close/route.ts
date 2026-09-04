import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { prelimAuth, isErr } from '@/lib/prelim'

// Close a session (or reopen it). Closing refuses while a document still has no outcome,
// so a session cannot be closed with drawings nobody decided on.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await prelimAuth('manage'); if (isErr(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const reopen = body?.reopen === true
  const db = createServiceClient()
  if (!reopen) {
    const { count } = await db.from('prelim_document').select('id', { count: 'exact', head: true }).eq('session_id', id).eq('outcome', 'pending')
    if ((count ?? 0) > 0) return NextResponse.json({ error: `${count} document${count === 1 ? '' : 's'} still ${count === 1 ? 'has' : 'have'} no outcome. Decide those first.` }, { status: 409 })
  }
  const { error } = await db.from('prelim_session').update(reopen
    ? { status: 'open', closed_at: null, closed_by_email: null }
    : { status: 'closed', closed_at: new Date().toISOString(), closed_by_email: auth.email }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await db.from('audit_events').insert({
    entity_type: 'prelim_session', entity_id: id, event_type: reopen ? 'prelim_session_reopened' : 'prelim_session_closed',
    actor_user_id: auth.userId, actor_email: auth.email, event_data: {},
  }).then(() => null, () => null)
  return NextResponse.json({ ok: true })
}
