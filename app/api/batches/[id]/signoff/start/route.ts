/**
 * POST /api/batches/[id]/signoff/start
 * Sends a Review-complete internal-review batch for sign-off:
 *   - renders the finalised native file to PDF (Graph),
 *   - appends the approval block (one empty row per signatory),
 *   - stores the PDF in Internal Reviews / Signed,
 *   - creates the signoff_tasks chain and emails the first signatory.
 * Body: { signatories: [{ email, name, role }] } — in order.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { resolveDriveItemByUrl, getDriveItemContentBytes, uploadBytesToLibraryFolder } from '@/lib/services/graph'
import { appendSignoffBlock, findTitleBlockColumns } from '@/lib/signoff-pdf'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'

export const maxDuration = 120
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('id, role, email, full_name').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_START_SIGNOFF, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({} as any))
  const signatories = (Array.isArray(body.signatories) ? body.signatories : [])
    .map((s: any) => ({ email: String(s?.email ?? '').trim(), name: String(s?.name ?? '').trim(), role: String(s?.role ?? '').trim() }))
    .filter((s: any) => s.email.includes('@'))
  if (!signatories.length) return NextResponse.json({ error: 'Add at least one signatory.' }, { status: 400 })

  const db = createServiceClient()
  const { data: batch } = await db.from('batches')
    .select('id, source, status, internal_ref, document_versions(central_file_url, file_name, doc_name)')
    .eq('id', id).single()
  const b = batch as any
  if (!b) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (b.source !== 'internal_review') return NextResponse.json({ error: 'Sign-off applies to internal-review documents only.' }, { status: 400 })
  if (!['review_complete', 'signoff_declined'].includes(b.status))
    return NextResponse.json({ error: `This batch is not ready for sign-off (status: ${b.status}).` }, { status: 400 })

  const dv = (b.document_versions ?? [])[0]
  if (!dv?.central_file_url) return NextResponse.json({ error: 'No source file on this batch.' }, { status: 400 })

  // ── Convert native → PDF, store a CLEAN base + the initial sign-off PDF in Signed/ ──
  let pdfUrl: string
  let baseUrl: string
  try {
    const item = await resolveDriveItemByUrl(dv.central_file_url)
    if (!item?.driveId) return NextResponse.json({ error: 'Could not locate the source file in SharePoint.' }, { status: 404 })
    // Word/Excel → convert to PDF; a file that's already a PDF is used as-is
    // (Graph's ?format=pdf rejects PDF input with 406 InputFormatNotSupported).
    const ext = (item.name?.split('.').pop() || '').toLowerCase()
    const nativeRaw = ext === 'pdf'
      ? await getDriveItemContentBytes(item.driveId, item.id)
      : await getDriveItemContentBytes(item.driveId, item.id, 'pdf')
    const nativePdf = nativeRaw instanceof Uint8Array ? nativeRaw : new Uint8Array(nativeRaw)
    // If the cover has a Prepared/Checked/Approved title block, sign there (no appended page).
    // Only documents WITHOUT that block get the appended approval block as a fallback.
    const hasTitleBlock = await findTitleBlockColumns(nativePdf).catch(() => null)
    let bytes: Uint8Array
    if (hasTitleBlock) {
      bytes = nativePdf
    } else {
      ({ bytes } = await appendSignoffBlock(nativePdf, signatories.map((s: any) => ({ name: s.name, role: s.role })),
        { title: dv.doc_name ?? dv.file_name, reference: b.internal_ref ?? undefined }))
    }
    const safe = String(b.internal_ref ?? b.id).replace(/[^A-Za-z0-9._-]/g, '_')
    // The clean base (no signatures) — every future stamp/reposition rebuilds from this.
    const baseUp = await uploadBytesToLibraryFolder(`Signed/base/${safe}.pdf`, nativePdf, 'application/pdf')
    baseUrl = baseUp.webUrl
    const up = await uploadBytesToLibraryFolder(`Signed/${safe}.pdf`, bytes, 'application/pdf')
    pdfUrl = up.webUrl
  } catch (e: any) {
    return NextResponse.json({ error: `Could not prepare the sign-off PDF: ${e?.message ?? e}` }, { status: 502 })
  }

  const now = new Date().toISOString()
  await db.from('batches').update({
    status: 'signoff_in_progress', signoff_pdf_url: pdfUrl, signoff_base_url: baseUrl, signoff_started_at: now, updated_at: now,
  }).eq('id', id)

  // Replace any prior (declined) chain, then create the new one.
  await db.from('signoff_tasks').delete().eq('batch_id', id)
  const rows = signatories.map((s: any, i: number) => ({
    batch_id: id, signatory_email: s.email, signatory_name: s.name || s.email,
    role_label: s.role || null, sequence_number: i + 1, block_row: i,
    status: i === 0 ? 'sent' : 'pending',
  }))
  const { data: inserted, error: te } = await db.from('signoff_tasks').insert(rows).select('id, sequence_number, signatory_email, signatory_name, role_label')
  if (te) return NextResponse.json({ error: te.message }, { status: 500 })

  const first = (inserted ?? []).find((t: any) => t.sequence_number === 1)

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: id, event_type: 'signoff_started',
    actor_user_id: profile?.id ?? null, actor_email: profile?.email ?? null,
    event_data: { signatories: signatories.map((s: any) => ({ email: s.email, role: s.role })), pdfUrl },
  })

  // Email the first signatory (best-effort).
  if (first) {
    try {
      await sendMail({
        to: [first.signatory_email],
        subject: `Sign-off requested — ${b.internal_ref ?? ''} ${dv.doc_name ?? dv.file_name}`,
        htmlBody: brandedEmail({
          heading: 'Your signature is requested',
          bodyHtml: `<p>You've been asked to sign off <b>${dv.doc_name ?? dv.file_name}</b>${b.internal_ref ? ` (${b.internal_ref})` : ''}${first.role_label ? ` as <b>${first.role_label}</b>` : ''}.</p>
            <p style="color:#6b7280;font-size:13px">Open it in CoreDocs, review the document, and apply your signature — no SharePoint needed.</p>`,
          cta: { href: `${APP_URL}/signoff/${first.id}`, label: 'Open & sign →' },
        }),
      })
    } catch {}
  }

  return NextResponse.json({ success: true, batchId: id, pdfUrl, signatories: rows.length }, { status: 201 })
}
