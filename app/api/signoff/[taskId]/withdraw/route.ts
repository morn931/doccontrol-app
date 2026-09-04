/**
 * POST /api/signoff/[taskId]/withdraw — the signatory takes their OWN signature back off a
 * document they have already signed.
 *
 * Why this exists: signing was a one-way door. Decline only works BEFORE you sign, and the
 * only way back afterwards was to ask a controller to reset the whole chain, which throws
 * away everyone else's signatures too. Reported 2026-09-04 ("trying to undo my signature …
 * can't find a way to undo the signature").
 *
 * It is safe because the signed PDF is REBUILT from the clean base every time — the stamp is
 * never baked in. Dropping the task out of 'signed' and rebuilding simply leaves it out.
 *
 * The one thing it must not do is rewrite a document somebody else has already approved. If a
 * LATER signatory has signed, this refuses and names them: that is a controller reset, because
 * their approval was given to a document that would no longer exist.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { rebuildBatchSignedPdf } from '@/lib/signoff-rebuild'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { splitEmails } from '@/lib/utils/emails'

export const maxDuration = 120
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('full_name').eq('auth_user_id', user.id).maybeSingle()

  const { taskId } = await params
  const body = await req.json().catch(() => ({} as any))
  const reason = String(body?.reason ?? '').trim() || null   // optional — never demanded

  const db = createServiceClient()
  const { data: task } = await db.from('signoff_tasks')
    .select('id, batch_id, signatory_email, role_label, sequence_number, status').eq('id', taskId).single()
  const t = task as any
  if (!t) return NextResponse.json({ error: 'Sign-off task not found' }, { status: 404 })
  if (t.signatory_email.toLowerCase() !== user.email.toLowerCase())
    return NextResponse.json({ error: 'This signature belongs to someone else.' }, { status: 403 })
  if (t.status !== 'signed') return NextResponse.json({ error: 'There is no signature of yours to remove.' }, { status: 400 })

  const { data: siblings } = await db.from('signoff_tasks')
    .select('id, sequence_number, status, signatory_email, signatory_name, role_label').eq('batch_id', t.batch_id)
  const all = (siblings ?? []) as any[]

  // Anyone who signed AFTER me signed a document that included my signature. Removing it now
  // would change what they approved, so this is not mine to undo.
  const laterSigned = all.filter((s) => s.sequence_number > t.sequence_number && s.status === 'signed')
  if (laterSigned.length) {
    const who = laterSigned.map((s) => s.signatory_name || s.signatory_email).join(', ')
    return NextResponse.json({
      error: `${who} already signed after you, so removing your signature now would change a document they have approved. Ask a document controller to reset the sign-off on this batch.`,
    }, { status: 409 })
  }

  const now = new Date().toISOString()

  // Back to 'opened' — it is still their task and still their turn; they can sign again, or
  // decline. Placement is cleared too, so a re-sign starts from the default box rather than
  // wherever they had nudged it for a document they have since withdrawn from.
  await db.from('signoff_tasks').update({
    status: 'opened', signed_at: null, signature_data: null, updated_at: now,
    place_page: null, place_x: null, place_y: null, place_w: null, place_h: null,
    place_date_x: null, place_date_y: null,
  }).eq('id', taskId)

  // The next signatory was activated by my signing. Put them back to pending so they are not
  // asked to sign a document that is now short a signature.
  const next = all
    .filter((s) => s.sequence_number > t.sequence_number && ['sent', 'opened'].includes(s.status))
    .sort((a, b) => a.sequence_number - b.sequence_number)[0]
  if (next) await db.from('signoff_tasks').update({ status: 'pending', updated_at: now }).eq('id', next.id)

  const { data: batch } = await db.from('batches')
    .select('id, internal_ref, status, document_versions(doc_name, file_name)').eq('id', t.batch_id).single()
  const b = batch as any
  if (b?.status === 'signed') {
    await db.from('batches').update({ status: 'signoff_in_progress', signed_at: null, updated_at: now }).eq('id', b.id)
  }

  // Re-stamp from the clean base without this signature. If it fails the document still holds
  // the old stamp, so put the task back rather than leaving the record and the PDF disagreeing.
  const rb = await rebuildBatchSignedPdf(db, t.batch_id)
  if (!rb.ok) {
    await db.from('signoff_tasks').update({ status: 'signed', updated_at: now }).eq('id', taskId)
    return NextResponse.json({ error: rb.error ?? 'Could not remove the signature from the document.' }, { status: 502 })
  }

  const docTitle = ((b?.document_versions ?? [])[0]?.doc_name) ?? ((b?.document_versions ?? [])[0]?.file_name) ?? 'document'
  const whoAmI = profile?.full_name ?? user.email

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: t.batch_id, event_type: 'signoff_withdrawn',
    actor_user_id: null, actor_email: user.email,
    event_data: { taskId, role: t.role_label, reason, revertedNext: next?.id ?? null },
  })

  // Tell the people whose expectations just changed: the next signatory (who had been asked to
  // sign and no longer should) and the controller. Best-effort — never fails the withdrawal.
  try {
    const { data: setting } = await db.from('system_settings').select('value').eq('key', 'doc_request_controller_email').maybeSingle()
    const controller = splitEmails((setting as any)?.value)
    if (!controller.length) controller.push('mornec@ppetech.co.za')
    await sendMail({
      to: controller,
      subject: `Signature withdrawn — ${b?.internal_ref ?? ''} ${docTitle}`,
      htmlBody: brandedEmail({
        heading: 'A signatory removed their signature',
        bodyHtml: `<p><b>${whoAmI}</b> removed their signature${t.role_label ? ` (${t.role_label})` : ''} from <b>${docTitle}</b>${b?.internal_ref ? ` (${b.internal_ref})` : ''}.</p>
          ${reason ? `<p style="margin:12px 0"><b>Reason given:</b><br/>${reason}</p>` : ''}
          <p style="color:#6b7280;font-size:13px">The document has been re-stamped without it and it is back with them to sign.</p>`,
        cta: { href: `${APP_URL}/batches/${t.batch_id}`, label: 'Open batch →' },
      }),
    })
  } catch {}

  if (next) {
    try {
      await sendMail({
        to: [next.signatory_email],
        subject: `Sign-off paused — ${b?.internal_ref ?? ''} ${docTitle}`,
        htmlBody: brandedEmail({
          heading: 'Hold off on this one for now',
          bodyHtml: `<p><b>${whoAmI}</b> has taken their signature back off <b>${docTitle}</b>${b?.internal_ref ? ` (${b.internal_ref})` : ''}, so it is not ready for yours yet.</p>
            <p style="color:#6b7280;font-size:13px">You will be emailed again when it is your turn. Nothing is needed from you in the meantime.</p>`,
        }),
      })
    } catch {}
  }

  return NextResponse.json({ success: true })
}
