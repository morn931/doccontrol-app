/**
 * POST /api/documents/internal-submit
 *
 * The internal-engineering driveway (Step 2). An engineer uploads the drawing he wants
 * reviewed, from his Document Request line. The upload:
 *   - confirms the file's document number against the line's allocated RDMC number,
 *   - stores the review copy in the DocumentControl SharePoint library (so the existing
 *     review engine serves + marks it up unchanged),
 *   - creates a batch tagged source='internal' + a document + version, linked to the line,
 *   - drops into the SAME review engine (status 'metadata_pending' → Incoming Batches).
 *
 * Metadata (discipline/type/number/title) comes authoritatively from the request line the
 * engineer already filled — no AI classification needed for internal documents.
 *
 * The drawing file itself is uploaded straight to SharePoint by the browser first (via
 * POST /api/documents/internal-submit/start-upload, which validates + hands back a direct
 * upload URL). This route FINALISES from JSON — it receives the SharePoint URL, not the file
 * bytes — so a big PDF never hits Vercel's ~4.5 MB request-body cap (which returned a plaintext
 * 413 "Request Entity Too Large" that the browser choked on: "Unexpected token 'R', 'Request En'…").
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPermissions, can, FK } from '@/lib/permissions'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { splitEmails } from '@/lib/utils/emails'

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

type Rec = { email: string; name: string }
function parseRecs(raw: unknown): Rec[] {
  try {
    const arr = JSON.parse(String(raw ?? '[]'))
    if (!Array.isArray(arr)) return []
    const seen = new Set<string>()
    return arr
      .map((r: any) => ({ email: String(r?.email ?? '').trim(), name: String(r?.name ?? '').trim() }))
      .filter((r) => r.email && !seen.has(r.email) && (seen.add(r.email), true))
      .map((r) => ({ email: r.email, name: r.name || r.email }))
      .slice(0, 20)
  } catch { return [] }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const role = (profile?.role ?? 'reviewer') as string
  const perms = await getPermissions(supabase)

  // The browser already uploaded the file straight to SharePoint (start-upload); we finalise
  // from JSON — the file's SharePoint URL + name, never the bytes.
  const body = await req.json().catch(() => null)
  const lineId = String(body?.lineId ?? '')
  const fileName = String(body?.fileName ?? '')
  const spFileUrl = String(body?.spFileUrl ?? '')
  const newRevision = body?.newRevision === true || body?.newRevision === '1'
  // "Sign-off only" revision returned from Aconex (already reviewed → skip the review cycle):
  //   signoffOnly=true         → DC-initiated: lands the revision straight at review_complete.
  //   requestSignoffOnly=true  → owner-requested: stays in the queue, badged, for the DC to flag.
  const signoffOnly = body?.signoffOnly === true || body?.signoffOnly === '1'
  const requestSignoffOnly = body?.requestSignoffOnly === true || body?.requestSignoffOnly === '1'
  const signoffOnlyReason = String(body?.signoffOnlyReason ?? '').trim()
    || 'Returned from Aconex for revision — already reviewed.'
  const canApproveSignoffOnly = can(perms, FK.ACTION_APPROVE_SIGNOFF_ONLY, role)
  if (!can(perms, FK.ACTION_SUBMIT_INTERNAL_DRAWING, role) && !(signoffOnly && canApproveSignoffOnly))
    return NextResponse.json({ error: 'Not authorised to submit an internal drawing.' }, { status: 403 })
  // A DC-initiated sign-off-only upload requires the flag permission even if they also hold submit.
  if (signoffOnly && !canApproveSignoffOnly)
    return NextResponse.json({ error: 'Not authorised to send a document straight to sign-off.' }, { status: 403 })
  // A re-issue can legitimately come back at the SAME revision label (common from Aconex);
  // start-upload already got the operator's confirm before the file was uploaded.
  const confirmSameRevision = body?.confirmSameRevision === true || body?.confirmSameRevision === '1'
  const recommendedReviewers = parseRecs(body?.recommendedReviewers)
  if (!lineId) return NextResponse.json({ error: 'Missing request line.' }, { status: 400 })
  if (!fileName || !spFileUrl) return NextResponse.json({ error: 'Upload did not complete — please try again.' }, { status: 400 })

  const svc = createServiceClient()

  // ─── Load the allocated request line ──────────────────────────────────────
  const { data: line } = await svc.from('document_number_request_line')
    .select('id, request_id, rdmc_document_number, full_title, discipline_code, document_type_code, revision, linked_document_id, title1, title2, title3')
    .eq('id', lineId).single()
  if (!line) return NextResponse.json({ error: 'Request line not found.' }, { status: 404 })
  if (!line.rdmc_document_number)
    return NextResponse.json({ error: 'This line has no allocated number yet — Document Control must allocate it first.' }, { status: 400 })
  // A line normally holds ONE drawing. But when a newer revision comes back (e.g. from
  // Aconex), "Submit new revision" re-books it: a fresh review/sign-off cycle on the SAME
  // document. Without that flag, a re-submit is still blocked.
  const existingDocId: string | null = line.linked_document_id ?? null
  if (existingDocId && !newRevision)
    return NextResponse.json({ error: 'A drawing has already been submitted for this line. Use "Submit new revision" to book a newer revision in.' }, { status: 409 })
  // Skipping review is only safe for a document that already has a revision in CoreDocs (the
  // premise: it was reviewed before, went to Aconex, and is coming back for a Rev bump).
  if (signoffOnly && !existingDocId)
    return NextResponse.json({ error: 'Sign-off-only applies to a document that already has a revision in CoreDocs. This line has none yet — submit it for review first.' }, { status: 400 })

  const { data: reqHdr } = await svc.from('document_number_request')
    .select('id, package_id').eq('id', line.request_id).single()

  // ─── Confirm the file's number against the allocated number ──────────────
  const parsed = parseDocumentFileName(fileName)
  if (norm(parsed.normalizedDocumentNumber) !== norm(line.rdmc_document_number)) {
    return NextResponse.json({
      error: `The file's number (${parsed.displayDocumentNumber}) does not match the allocated number (${line.rdmc_document_number}). Rename the file to ${line.rdmc_document_number}_${line.revision ?? 'A'}.pdf and try again.`,
    }, { status: 422 })
  }
  // The revision is whatever the filename says — we mirror it verbatim (Aconex numbering).
  const revision = parsed.revision ?? line.revision ?? 'A'
  const title = line.full_title ?? ([line.title1, line.title2, line.title3].filter(Boolean).join(' — ') || null)

  // New-revision re-book: if that same revision is already in CoreDocs for this doc, a re-issue
  // at the same label is a real Aconex case — allow it, but only on explicit confirm, so an
  // accidental double-upload of the same revision doesn't silently start another cycle.
  if (existingDocId && !confirmSameRevision) {
    const { data: existingVers } = await svc.from('document_versions').select('revision').eq('document_id', existingDocId)
    const have = new Set((existingVers ?? []).map((v: any) => String(v.revision ?? '').toUpperCase()))
    if (have.has(String(revision).toUpperCase()))
      return NextResponse.json({
        error: `Revision ${revision} is already in CoreDocs for ${line.rdmc_document_number}. Re-issue it at the same revision (a fresh review & sign-off cycle)?`,
        needsConfirm: 'sameRevision',
      }, { status: 409 })
  }

  // ─── Review copy already in SharePoint (uploaded by the browser in start-upload) ─
  const centralUrl = spFileUrl

  // ─── Create batch (source='internal') + document + version, link the line ─
  const nowIso = new Date().toISOString()
  const { data: batch, error: be } = await svc.from('batches').insert({
    batch_guid:      randomUUID(),
    source:          'internal',
    request_line_id: line.id,
    package_id:      reqHdr?.package_id ?? null,
    // DC sign-off-only upload lands straight at review_complete (the sign-off gate accepts it);
    // everything else enters review at metadata_pending.
    status:          signoffOnly ? 'review_complete' : 'metadata_pending',
    file_count:      1,
    received_at:     nowIso,
    recommended_reviewers: recommendedReviewers.length ? recommendedReviewers : null,
    signoff_only:              signoffOnly,
    signoff_only_reason:       (signoffOnly || requestSignoffOnly) ? signoffOnlyReason : null,
    signoff_only_requested_by: requestSignoffOnly ? (profile?.email ?? null) : null,
    signoff_only_requested_at: requestSignoffOnly ? nowIso : null,
    signoff_only_approved_by:  signoffOnly ? (profile?.email ?? null) : null,
    signoff_only_approved_at:  signoffOnly ? nowIso : null,
  }).select('id').single()
  if (be || !batch) return NextResponse.json({ error: be?.message ?? 'Could not create batch.' }, { status: 500 })

  let doc: { id: string } | null
  if (existingDocId) {
    // New revision → reuse the existing document; the prior version is no longer latest.
    doc = { id: existingDocId }
    await svc.from('document_versions').update({ is_latest: false }).eq('document_id', existingDocId)
  } else {
    const { data, error: de } = await svc.from('documents').insert({
      normalized_document_number: line.rdmc_document_number,
      display_document_number:    line.rdmc_document_number,
      title,
      package_id:    reqHdr?.package_id ?? null,
      discipline:    line.discipline_code ?? null,
      document_type: line.document_type_code ?? null,
    }).select('id').single()
    if (de || !data) return NextResponse.json({ error: de?.message ?? 'Could not create document.' }, { status: 500 })
    doc = data
  }

  const { data: dv, error: ve } = await svc.from('document_versions').insert({
    document_id:        doc.id,
    batch_id:           batch.id,
    file_name:          fileName,
    revision,
    revision_sort:      parsed.revisionSort ?? revision,
    central_file_url:   centralUrl,
    storage_provider:   'sharepoint',
    doc_name:           title,
    discipline:         line.discipline_code ?? null,
    document_type:      line.document_type_code ?? null,
    ai_metadata_source: 'manually_confirmed',
    status:             'uploaded',
    is_latest:          true,
  }).select('id').single()
  if (ve || !dv) return NextResponse.json({ error: ve?.message ?? 'Could not create document version.' }, { status: 500 })

  await svc.from('documents').update({ current_version_id: dv.id }).eq('id', doc.id)
  await svc.from('document_number_request_line')
    .update({ linked_document_id: doc.id, updated_at: new Date().toISOString() }).eq('id', line.id)

  await svc.from('audit_events').insert({
    entity_type: 'batch', entity_id: batch.id,
    event_type: signoffOnly ? 'signoff_only_uploaded'
      : requestSignoffOnly ? 'signoff_only_requested' : 'internal_drawing_submitted',
    actor_user_id: profile?.id ?? null, actor_email: profile?.email ?? null,
    event_data: {
      rdmc: line.rdmc_document_number, revision, fileName, requestId: line.request_id,
      ...(signoffOnly || requestSignoffOnly ? { signoffOnly, requestSignoffOnly, reason: signoffOnlyReason } : {}),
    },
  })

  // Notify the Document Controller (best-effort — never fail the submission on email).
  try {
    const { data: setting } = await svc.from('system_settings').select('value').eq('key', 'doc_request_controller_email').maybeSingle()
    const controller = splitEmails(setting?.value)
    if (!controller.length) controller.push('mornec@ppetech.co.za')

    if (signoffOnly) {
      // The DC uploaded it herself → it's already Review-complete and ready for sign-off. No nudge.
    } else if (requestSignoffOnly) {
      // Owner asked to skip review → tell the DC she can flag it straight to sign-off, or clear it.
      await sendMail({
        to: controller,
        subject: `Sign-off only requested — ${line.rdmc_document_number} (Rev ${revision})`,
        htmlBody: brandedEmail({
          heading: 'Sign-off only requested (returned from Aconex)',
          bodyHtml: `<p><b>${profile?.email ?? 'An engineer'}</b> submitted a new revision and asked to send it <b>straight to sign-off</b> — the previous revision was already reviewed (returned from Aconex).</p>
            <p style="margin:12px 0"><b>Document:</b> ${line.rdmc_document_number} (Rev ${revision})<br/>
            <b>Title:</b> ${title ?? '—'}<br/><b>Reason:</b> ${signoffOnlyReason}</p>
            <p style="color:#6b7280;font-size:13px">Open the batch to flag it straight to sign-off, or clear the request and send it through the normal review.</p>`,
          cta: { href: `${APP_URL}/batches/${batch.id}`, label: 'Review the request →' },
        }),
      })
    } else {
      const recsHtml = recommendedReviewers.length
        ? `<p style="margin:12px 0"><b>Reviewers recommended by the submitter:</b></p>
           <ul style="padding-left:18px;color:#374151">${recommendedReviewers.map((r) => `<li>${r.name} &lt;${r.email}&gt;</li>`).join('')}</ul>
           <p style="color:#6b7280;font-size:13px">These will pre-fill the review sequence — you can add or remove reviewers before starting.</p>`
        : `<p style="color:#6b7280">The submitter did not recommend any reviewers.</p>`
      await sendMail({
        to: controller,
        subject: `Internal drawing submitted for review — ${line.rdmc_document_number} (Rev ${revision})`,
        htmlBody: brandedEmail({
          heading: 'Internal drawing ready to assign reviewers',
          bodyHtml: `<p><b>${profile?.email ?? 'An engineer'}</b> has submitted an internal drawing for review.</p>
            <p style="margin:12px 0"><b>Document:</b> ${line.rdmc_document_number} (Rev ${revision})<br/>
            <b>Title:</b> ${title ?? '—'}</p>${recsHtml}`,
          cta: { href: `${APP_URL}/batches/${batch.id}/assign`, label: 'Assign reviewers →' },
        }),
      })
    }
  } catch {}

  return NextResponse.json({
    success: true, batchId: batch.id, docNumber: line.rdmc_document_number, revision,
  }, { status: 201 })
}
