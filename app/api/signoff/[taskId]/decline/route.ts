/**
 * POST /api/signoff/[taskId]/decline — the assigned signatory declines with a reason. The
 * batch returns to the controller (status signoff_declined) so it can be corrected and
 * re-sent; not a dead-end.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { splitEmails } from '@/lib/utils/emails'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('full_name').eq('auth_user_id', user.id).maybeSingle()

  const { taskId } = await params
  const body = await req.json().catch(() => ({} as any))
  const reason = String(body.reason ?? '').trim()
  if (!reason) return NextResponse.json({ error: 'A reason is required to decline.' }, { status: 400 })

  const db = createServiceClient()
  const { data: task } = await db.from('signoff_tasks').select('id, batch_id, signatory_email, status').eq('id', taskId).single()
  const t = task as any
  if (!t) return NextResponse.json({ error: 'Sign-off task not found' }, { status: 404 })
  if (t.signatory_email.toLowerCase() !== user.email.toLowerCase())
    return NextResponse.json({ error: 'This signature is assigned to someone else.' }, { status: 403 })
  if (!['sent', 'opened'].includes(t.status)) return NextResponse.json({ error: `Not available to decline (status: ${t.status}).` }, { status: 400 })

  const now = new Date().toISOString()
  await db.from('signoff_tasks').update({ status: 'declined', decline_reason: reason, updated_at: now }).eq('id', taskId)
  await db.from('batches').update({ status: 'signoff_declined', updated_at: now }).eq('id', t.batch_id)

  const { data: batch } = await db.from('batches').select('internal_ref, document_versions(doc_name, file_name)').eq('id', t.batch_id).single()
  const b = batch as any
  const docTitle = ((b?.document_versions ?? [])[0]?.doc_name) ?? ((b?.document_versions ?? [])[0]?.file_name) ?? 'document'

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: t.batch_id, event_type: 'signoff_declined',
    actor_user_id: null, actor_email: user.email, event_data: { taskId, reason },
  })

  // Notify the controller so they can correct + re-send (best-effort).
  try {
    const { data: setting } = await db.from('system_settings').select('value').eq('key', 'doc_request_controller_email').maybeSingle()
    const controller = splitEmails((setting as any)?.value)
    if (!controller.length) controller.push('mornec@ppetech.co.za')
    await sendMail({
      to: controller,
      subject: `Sign-off declined — ${b?.internal_ref ?? ''} ${docTitle}`,
      htmlBody: brandedEmail({
        heading: 'A sign-off was declined',
        bodyHtml: `<p><b>${profile?.full_name ?? user.email}</b> declined to sign <b>${docTitle}</b>${b?.internal_ref ? ` (${b.internal_ref})` : ''}.</p>
          <p style="margin:12px 0"><b>Reason:</b><br/>${reason}</p>
          <p style="color:#6b7280;font-size:13px">Correct the document and re-send it for sign-off from the batch.</p>`,
        cta: { href: `${APP_URL}/batches/${t.batch_id}`, label: 'Open batch →' },
      }),
    })
  } catch {}

  return NextResponse.json({ success: true })
}
