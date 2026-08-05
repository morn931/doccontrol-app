import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'

export const dynamic = 'force-dynamic'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

// POST — add a reply to an action's thread. This is the loop-closer: whoever ISN'T the
// author (raiser + assignee) gets notified, so the person who asked finally sees the answer.
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
  // Assignee picking up an action moves it to in-progress (if still open).
  await db.from('engineering_action').update({ updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'open')

  const recipients = [...new Set([(action as any).raised_by_email, (action as any).assigned_to_email]
    .filter((e: string) => e && e.toLowerCase() !== author_email.toLowerCase()))]
  if (recipients.length) {
    try {
      await sendMail({
        to: recipients,
        subject: `Reply on engineering action ${(action as any).action_ref}`,
        htmlBody: brandedEmail({
          heading: 'New reply on an engineering action',
          bodyHtml: `<p><b>${author_name || author_email}</b> replied on <b>${(action as any).action_ref}</b>${(action as any).document_number ? ` (${(action as any).document_number})` : ''} — “${(action as any).description}”:</p>
            <p style="padding:8px 12px;border-left:3px solid #2563eb;background:#eff6ff">${body}</p>`,
          cta: { href: `${APP_URL}/engineering-actions`, label: 'Open the register →' },
        }),
      })
    } catch {}
  }
  return NextResponse.json({ ok: true })
}
