/**
 * POST /api/internal-review/submit
 *
 * The 4th review front-door — "Internal Review" (Phase 1). For internal WORKING documents
 * (Word/Excel/PDF) that have NO vendor and NO document number yet, and may never go to
 * Aconex. The upload:
 *   - stores the file in the isolated "Internal Reviews" library (NOT an engineer-facing
 *     Aconex-synced library), so it never appears where site engineers look;
 *   - mints a temporary reference (INT-YYYY-NNNN) — no RDMC number required;
 *   - creates a batch (source='internal_review') + document_version and drops it into the
 *     SAME review engine (status 'metadata_pending' → Incoming Batches) for the controller
 *     to assign reviewers.
 * The document stays in its NATIVE form throughout review (comment-based; no markup, no PDF
 * conversion). Sign-off / PDF / Aconex are Phase 2/3.
 *
 * Route handler (not a server action) so large files aren't capped by the action body limit.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPermissions, can, FK } from '@/lib/permissions'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { uploadBytesToLibrary } from '@/lib/services/graph'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { splitEmails } from '@/lib/utils/emails'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

// Parse the optional "recommend reviewers" field — comma/newline/semicolon emails.
function parseReviewerEmails(raw: unknown): { email: string; name: string }[] {
  const seen = new Set<string>()
  return String(raw ?? '')
    .split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
    .filter(e => e.includes('@') && !seen.has(e.toLowerCase()) && (seen.add(e.toLowerCase()), true))
    .slice(0, 20)
    .map(email => ({ email, name: email }))
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const role = (profile?.role ?? 'reviewer') as string
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_START_INTERNAL_REVIEW, role))
    return NextResponse.json({ error: 'Not authorised to start an internal review.' }, { status: 403 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  const title = String(form.get('title') ?? '').trim()
  const discipline = String(form.get('discipline') ?? '').trim() || null
  const documentType = String(form.get('documentType') ?? '').trim() || null
  const packageId = String(form.get('packageId') ?? '').trim() || null
  const recommendedReviewers = parseReviewerEmails(form.get('recommendedReviewers'))

  if (!file || file.size === 0) return NextResponse.json({ error: 'Choose a file to send for internal review.' }, { status: 400 })
  if (!title) return NextResponse.json({ error: 'Give the document a title.' }, { status: 400 })

  const svc = createServiceClient()

  // ── Store the working copy in the isolated "Internal Reviews" library ────────
  let centralUrl: string
  try {
    const bytes = await file.arrayBuffer()
    const up = await uploadBytesToLibrary(file.name, bytes, file.type || 'application/octet-stream')
    centralUrl = up.webUrl
  } catch (e: any) {
    return NextResponse.json({ error: `Upload to SharePoint failed: ${e?.message ?? e}` }, { status: 502 })
  }

  // ── Mint the temporary reference (INT-YYYY-NNNN) ─────────────────────────────
  const { data: refData, error: refErr } = await svc.rpc('next_internal_ref')
  const internalRef = (refData as string | null) ?? `INT-${randomUUID().slice(0, 8)}`
  if (refErr) console.warn('next_internal_ref failed, using fallback ref:', refErr.message)

  // ── Create batch (source='internal_review') + document_version ───────────────
  const { data: batch, error: be } = await svc.from('batches').insert({
    batch_guid:   randomUUID(),
    source:       'internal_review',
    vendor_id:    null,
    package_id:   packageId,
    internal_ref: internalRef,
    status:       'metadata_pending',
    file_count:   1,
    received_at:  new Date().toISOString(),
    recommended_reviewers: recommendedReviewers.length ? recommendedReviewers : null,
  }).select('id').single()
  if (be || !batch) return NextResponse.json({ error: be?.message ?? 'Could not create the review batch.' }, { status: 500 })

  const parsed = parseDocumentFileName(file.name)
  const { data: dv, error: ve } = await svc.from('document_versions').insert({
    batch_id:           batch.id,
    document_id:        null,          // no controlled-document record yet — it has no number
    file_name:          file.name,
    revision:           parsed.revision ?? null,
    revision_sort:      parsed.revisionSort ?? parsed.revision ?? null,
    central_file_url:   centralUrl,
    doc_unique_id:      internalRef,
    storage_provider:   'sharepoint',
    doc_name:           title,
    discipline,
    document_type:      documentType,
    ai_metadata_source: 'manually_confirmed',
    status:             'uploaded',
    is_latest:          true,
  }).select('id').single()
  if (ve || !dv) return NextResponse.json({ error: ve?.message ?? 'Could not create the document version.' }, { status: 500 })

  await svc.from('audit_events').insert({
    entity_type: 'batch', entity_id: batch.id, event_type: 'internal_review_submitted',
    actor_user_id: profile?.id ?? null, actor_email: profile?.email ?? null,
    event_data: { internalRef, title, fileName: file.name },
  })

  // ── Notify the controller that an internal review is ready to assign (best-effort) ──
  try {
    const { data: setting } = await svc.from('system_settings').select('value').eq('key', 'doc_request_controller_email').maybeSingle()
    const controller = splitEmails(setting?.value)
    if (!controller.length) controller.push('mornec@ppetech.co.za')
    const recsHtml = recommendedReviewers.length
      ? `<p style="margin:12px 0"><b>Reviewers recommended by the submitter:</b></p>
         <ul style="padding-left:18px;color:#374151">${recommendedReviewers.map(r => `<li>${r.email}</li>`).join('')}</ul>`
      : `<p style="color:#6b7280">No reviewers recommended — assign them on the batch.</p>`
    await sendMail({
      to: controller,
      subject: `Internal review submitted — ${internalRef} (${title})`,
      htmlBody: brandedEmail({
        heading: 'Internal document ready to assign reviewers',
        bodyHtml: `<p><b>${profile?.email ?? 'A user'}</b> submitted an internal document for review.</p>
          <p style="margin:12px 0"><b>Ref:</b> ${internalRef}<br/><b>Title:</b> ${title}<br/><b>File:</b> ${file.name}</p>${recsHtml}
          <p style="color:#6b7280;font-size:13px">Reviewed in native form — no document number yet.</p>`,
        cta: { href: `${APP_URL}/batches/${batch.id}/assign`, label: 'Assign reviewers →' },
      }),
    })
  } catch {}

  return NextResponse.json({ success: true, batchId: batch.id, internalRef }, { status: 201 })
}
