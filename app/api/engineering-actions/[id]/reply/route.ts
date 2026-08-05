import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// POST — add a reply to an action's thread. The loop closes via the daily digest, which
// tells the raiser their action got a new answer (EM's preference: no instant emails).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const body = String((await req.json().catch(() => ({}))).body ?? '').trim()
  if (!body) return NextResponse.json({ error: 'Reply is required.' }, { status: 400 })

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email, full_name').eq('auth_user_id', user.id).single()
  const author_email = (profile as any)?.email ?? user.email ?? ''
  const author_name = (profile as any)?.full_name ?? null

  const { data: action } = await db.from('engineering_action')
    .select('action_ref, description, document_number, raised_by_email, assigned_to_email').eq('id', id).single()
  if (!action) return NextResponse.json({ error: 'Action not found.' }, { status: 404 })

  const { error } = await db.from('engineering_action_reply').insert({ action_id: id, author_email, author_name, body })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Reply from someone other than the raiser bumps the action to in-progress (if still open).
  if (author_email.toLowerCase() !== String((action as any).raised_by_email ?? '').toLowerCase())
    await db.from('engineering_action').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'open')
  else
    await db.from('engineering_action').update({ updated_at: new Date().toISOString() }).eq('id', id)
  // No email — the daily digest surfaces new answers to the raiser.
  return NextResponse.json({ ok: true })
}
