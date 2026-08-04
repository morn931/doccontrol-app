/**
 * POST /api/signoff/[taskId]/sign — the assigned signatory applies their signature:
 * fetch their stored signature, stamp it (image + date) into their row of the approval
 * block on the authoritative PDF, write it back to SharePoint, mark the task signed, and
 * advance the chain (email the next signatory, or mark the batch fully signed).
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getFileBytesByUrl, putFileBytesByUrl } from '@/lib/services/graph'
import { stampSignature, pngFromDataUrl } from '@/lib/signoff-pdf'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { splitEmails } from '@/lib/utils/emails'

export const maxDuration = 120
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'
const SHELL_URL = process.env.COREFLOW_SHELL_URL || 'https://coreflow.build'

async function signatureImageFor(email: string): Promise<string | null> {
  const secret = process.env.SIGNATURE_LOOKUP_SECRET
  if (!secret) return null
  try {
    const res = await fetch(`${SHELL_URL}/api/signature/by-email?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()).signature?.image ?? null
  } catch { return null }
}

export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('full_name').eq('auth_user_id', user.id).maybeSingle()

  const { taskId } = await params
  const db = createServiceClient()
  const { data: task } = await db.from('signoff_tasks')
    .select('id, batch_id, signatory_email, role_label, sequence_number, status, block_row').eq('id', taskId).single()
  const t = task as any
  if (!t) return NextResponse.json({ error: 'Sign-off task not found' }, { status: 404 })

  // Only the assigned signatory can sign, and only on their turn.
  if (t.signatory_email.toLowerCase() !== user.email.toLowerCase())
    return NextResponse.json({ error: 'This signature is assigned to someone else.' }, { status: 403 })
  if (t.status === 'signed') return NextResponse.json({ error: 'You have already signed.' }, { status: 400 })
  if (!['sent', 'opened'].includes(t.status)) return NextResponse.json({ error: `Not available to sign (status: ${t.status}).` }, { status: 400 })

  const { data: siblings } = await db.from('signoff_tasks').select('id, sequence_number, status, signatory_email, signatory_name, role_label').eq('batch_id', t.batch_id)
  const earlierOpen = (siblings ?? []).filter((s: any) => s.sequence_number < t.sequence_number && !['signed', 'declined'].includes(s.status))
  if (earlierOpen.length) return NextResponse.json({ error: 'An earlier signatory has not signed yet.' }, { status: 400 })

  const { data: batch } = await db.from('batches').select('id, internal_ref, signoff_pdf_url, document_versions(doc_name, file_name)').eq('id', t.batch_id).single()
  const b = batch as any
  if (!b?.signoff_pdf_url) return NextResponse.json({ error: 'No sign-off PDF on this batch.' }, { status: 400 })

  // ── Stamp the signature into the PDF and write it back ───────────────────────
  try {
    const current = await getFileBytesByUrl(b.signoff_pdf_url)
    const img = await signatureImageFor(user.email)
    const stamped = await stampSignature(current, {
      blockRow: t.block_row ?? (t.sequence_number - 1),
      dateStr: new Date().toISOString().slice(0, 10),
      signaturePng: pngFromDataUrl(img),
      typedName: profile?.full_name ?? user.email,   // fallback if no signature image on file
    })
    await putFileBytesByUrl(b.signoff_pdf_url, stamped)
  } catch (e: any) {
    return NextResponse.json({ error: `Could not stamp the signature: ${e?.message ?? e}` }, { status: 502 })
  }

  const now = new Date().toISOString()
  await db.from('signoff_tasks').update({ status: 'signed', signed_at: now, updated_at: now }).eq('id', taskId)

  // Advance: activate + email the next pending signatory, or finish the batch.
  const next = (siblings ?? [])
    .filter((s: any) => s.sequence_number > t.sequence_number && s.status === 'pending')
    .sort((a: any, b2: any) => a.sequence_number - b2.sequence_number)[0]

  const docTitle = ((b.document_versions ?? [])[0]?.doc_name) ?? ((b.document_versions ?? [])[0]?.file_name) ?? 'document'

  if (next) {
    await db.from('signoff_tasks').update({ status: 'sent', updated_at: now }).eq('id', next.id)
    try {
      await sendMail({
        to: [next.signatory_email],
        subject: `Sign-off requested — ${b.internal_ref ?? ''} ${docTitle}`,
        htmlBody: brandedEmail({
          heading: 'Your signature is requested',
          bodyHtml: `<p>The previous signatory has signed <b>${docTitle}</b>${b.internal_ref ? ` (${b.internal_ref})` : ''}. It's now your turn${next.role_label ? ` as <b>${next.role_label}</b>` : ''}.</p>`,
          cta: { href: `${APP_URL}/signoff/${next.id}`, label: 'Open & sign →' },
        }),
      })
    } catch {}
  } else {
    // Fully signed — mark the batch and notify the Document Controller that it's ready to
    // retrieve and upload to Aconex.
    await db.from('batches').update({ status: 'signed', signed_at: now, updated_at: now }).eq('id', b.id)
    try {
      const { data: setting } = await db.from('system_settings').select('value').eq('key', 'doc_request_controller_email').maybeSingle()
      const controller = splitEmails((setting as any)?.value)
      if (!controller.length) controller.push('mornec@ppetech.co.za')
      await sendMail({
        to: controller,
        subject: `Fully signed — ${b.internal_ref ?? ''} ${docTitle}`,
        htmlBody: brandedEmail({
          heading: 'Document fully signed — ready to issue',
          bodyHtml: `<p><b>${docTitle}</b>${b.internal_ref ? ` (${b.internal_ref})` : ''} has been signed by all signatories.</p>
            <p style="color:#6b7280;font-size:13px">It's ready to retrieve and upload to Aconex.${b.signoff_pdf_url ? ` The signed PDF: <a href="${b.signoff_pdf_url}">open in SharePoint</a>.` : ''}</p>`,
          cta: { href: `${APP_URL}/batches/${b.id}`, label: 'Open batch →' },
        }),
      })
    } catch {}
  }

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: b.id, event_type: 'signoff_signed',
    actor_user_id: null, actor_email: user.email,
    event_data: { taskId, role: t.role_label, finished: !next },
  })

  return NextResponse.json({ success: true, finished: !next })
}
