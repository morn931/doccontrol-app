import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getFileBytesByUrl, uploadBytesToLibrary, resolveDriveItemByUrl, getDriveItemContentBytes } from '@/lib/services/graph'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { splitEmails } from '@/lib/utils/emails'
import { prelimAuth, isErr } from '@/lib/prelim'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'
export const maxDuration = 120

// Hand a drawing the room marked READY over to the formal internal review — through the
// same two front doors an engineer uses, so everything downstream is untouched:
//   numbered   → documents + document_versions + batch source='internal'   (ENG2 return,
//                sign-off, Aconex issue, MDDR — the full chain)
//   unnumbered → batch source='internal_review' with an INT-YYYY-NNNN reference
// Both land in Incoming Batches as 'metadata_pending' for the controller to assign
// reviewers, exactly as if the engineer had submitted the file. The working copy — with
// the room's marks flattened in — becomes the review file; the room's comments become a
// reviewer handover note on the new version, so the formal reviewers start from what the
// room already said rather than repeating it.
//
// Body: { recommendedReviewers?: "a@x, b@y" }
export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('manage'); if (isErr(auth)) return auth
  const { docId } = await params
  const body = await req.json().catch(() => ({}))
  const recommended = String(body?.recommendedReviewers ?? '').split(/[\n,;]+/).map(s => s.trim()).filter(e => e.includes('@')).slice(0, 20).map(email => ({ email, name: email }))

  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document').select('*, prelim_session!inner(id, title, status, area)').eq('id', docId).maybeSingle()
  const d = doc as any
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (d.handed_over_batch_id) return NextResponse.json({ error: 'Already handed over.', batchId: d.handed_over_batch_id }, { status: 409 })
  if (d.outcome !== 'ready') return NextResponse.json({ error: 'Only a drawing the room marked "ready" can be handed over.' }, { status: 409 })
  // Unflattened marks would be lost: the formal review reads the FILE, not our layer.
  const layerHasMarks = d.markup_layer && typeof d.markup_layer === 'object' && Object.keys(d.markup_layer).length > 0
  if (layerHasMarks) return NextResponse.json({ error: 'The room\'s marks are not in the file yet — open the drawing and press "Save to SharePoint" first, then hand over.' }, { status: 409 })

  // ── the review file ───────────────────────────────────────────────────────────────
  // If the room drew on it, the marked-up working copy is the file. If nobody drew on it,
  // the LIVE source in COLAB is — the helper may have fixed quality issues there since the
  // pull, and a copy taken at pull time would carry the defects back in.
  const roomMarked = !!d.markup_committed_at
  let bytes: ArrayBuffer, fileSource = 'working copy (room markup)'
  try {
    if (roomMarked) bytes = await getFileBytesByUrl(d.working_file_url)
    else {
      const item = await resolveDriveItemByUrl(d.source_file_url)
      if (!item?.driveId) throw new Error('source file not found in COLAB')
      bytes = await getDriveItemContentBytes(item.driveId, item.id, /\.pdf$/i.test(item.name) ? undefined : 'pdf')
      fileSource = 'live source in COLAB'
    }
  } catch (e: any) { return NextResponse.json({ error: `Could not read the ${roomMarked ? 'working copy' : 'source file'}: ${e?.message ?? e}` }, { status: 502 }) }
  // Outstanding quality issues travel with it — flagged, never blocking.
  const qIssues: any[] = Array.isArray(d.quality_latest?.issues) ? d.quality_latest.issues : []
  const qOpen = qIssues.length
  const qualityFlag = d.quality_checked_at ? { prelim_quality: { open: qOpen, checked_at: d.quality_checked_at, source_modified_at: d.quality_source_modified_at ?? null, issues: qIssues } } : null
  const qualityText = d.quality_checked_at
    ? (qOpen ? `Prelim quality check (${new Date(d.quality_checked_at).toLocaleDateString('en-GB')}): ${qOpen} open issue${qOpen === 1 ? '' : 's'} — ${qIssues.slice(0, 6).map(i => `${i.page != null ? `p.${i.page} ` : ''}${i.description}`).join('; ')}${qOpen > 6 ? '; …' : ''}` : `Prelim quality check (${new Date(d.quality_checked_at).toLocaleDateString('en-GB')}): clear`)
    : 'Prelim quality check: not run'
  const docno: string | null = d.document_number || null
  const revision: string = d.revision || 'A'
  const fileName = docno ? `${docno}_${revision}.pdf` : d.working_file_name
  let centralUrl: string
  try { centralUrl = (await uploadBytesToLibrary(fileName, bytes, 'application/pdf')).webUrl }
  catch (e: any) { return NextResponse.json({ error: `Upload to Internal Reviews failed: ${e?.message ?? e}` }, { status: 502 }) }

  const now = new Date().toISOString()
  let batchId: string, dvId: string, ref: string
  if (docno) {
    // Numbered: the same shape the Sign-off Intake route creates, but at the START of the
    // chain (metadata_pending), not the end.
    let packageId: string | null = null
    if (d.cddl_doc_id) {
      const { data: c } = await db.from('cddl_doc').select('package_code').eq('id', d.cddl_doc_id).maybeSingle()
      if ((c as any)?.package_code) { const { data: pkg } = await db.from('packages').select('id').eq('package_code', (c as any).package_code).maybeSingle(); packageId = (pkg as any)?.id ?? null }
    }
    const { data: existing } = await db.from('documents').select('id').eq('normalized_document_number', docno).maybeSingle()
    let docRowId: string
    if (existing) { docRowId = (existing as any).id; await db.from('document_versions').update({ is_latest: false }).eq('document_id', docRowId) }
    else {
      const { data: created, error: de } = await db.from('documents').insert({
        normalized_document_number: docno, display_document_number: docno, title: d.title ?? null,
        package_id: packageId, discipline: d.discipline ?? null, document_type: d.document_type ?? null,
      }).select('id').single()
      if (de || !created) return NextResponse.json({ error: de?.message ?? 'Could not create the document.' }, { status: 500 })
      docRowId = (created as any).id
    }
    const { data: batch, error: be } = await db.from('batches').insert({
      batch_guid: randomUUID(), source: 'internal', package_id: packageId, status: 'metadata_pending',
      file_count: 1, received_at: now, recommended_reviewers: recommended.length ? recommended : null,
    }).select('id').single()
    if (be || !batch) return NextResponse.json({ error: be?.message ?? 'Could not create the batch.' }, { status: 500 })
    batchId = (batch as any).id
    const { data: dv, error: ve } = await db.from('document_versions').insert({
      document_id: docRowId, batch_id: batchId, file_name: fileName, revision, revision_sort: revision,
      central_file_url: centralUrl, storage_provider: 'sharepoint', doc_name: d.title ?? null,
      discipline: d.discipline ?? null, document_type: d.document_type ?? null,
      ai_metadata_source: 'manually_confirmed', status: 'uploaded', is_latest: true,
      ai_review: qualityFlag, ai_text: qualityText,
    }).select('id').single()
    if (ve || !dv) return NextResponse.json({ error: ve?.message ?? 'Could not create the document version.' }, { status: 500 })
    dvId = (dv as any).id
    await db.from('documents').update({ current_version_id: dvId }).eq('id', docRowId)
    ref = docno
  } else {
    // Unnumbered: the Internal Review front door, INT reference minted the same way.
    const { data: refData } = await db.rpc('next_internal_ref')
    ref = (refData as string | null) ?? `INT-${randomUUID().slice(0, 8)}`
    const { data: batch, error: be } = await db.from('batches').insert({
      batch_guid: randomUUID(), source: 'internal_review', vendor_id: null, internal_ref: ref, status: 'metadata_pending',
      file_count: 1, received_at: now, recommended_reviewers: recommended.length ? recommended : null,
    }).select('id').single()
    if (be || !batch) return NextResponse.json({ error: be?.message ?? 'Could not create the batch.' }, { status: 500 })
    batchId = (batch as any).id
    const { data: dv, error: ve } = await db.from('document_versions').insert({
      batch_id: batchId, document_id: null, file_name: fileName, revision: d.revision ?? null, revision_sort: d.revision ?? null,
      central_file_url: centralUrl, doc_unique_id: ref, storage_provider: 'sharepoint', doc_name: d.title ?? fileName,
      discipline: d.discipline ?? null, document_type: d.document_type ?? null,
      ai_metadata_source: 'manually_confirmed', status: 'uploaded', is_latest: true,
      ai_review: qualityFlag, ai_text: qualityText,
    }).select('id').single()
    if (ve || !dv) return NextResponse.json({ error: ve?.message ?? 'Could not create the document version.' }, { status: 500 })
    dvId = (dv as any).id
  }

  // ── what the room said, as a handover note every formal reviewer sees at the top ────
  const comments: any[] = d.markup_comments ?? []
  const noteLines = [
    `Prelim review — ${d.prelim_session.title}${d.prelim_session.area ? ` (${d.prelim_session.area})` : ''}. Outcome: ready for internal review. Review file taken from the ${fileSource}.`,
    d.outcome_note ? `Note from the room: ${d.outcome_note}` : null,
    qualityText,
    ...(qOpen ? qIssues.map((i, k) => `  Q${k + 1}. [${i.severity}] ${i.page != null ? `p.${i.page} ` : ''}${i.description} — fix: ${i.fix}`) : []),
    comments.length ? `Comments from the room (${comments.length}):` : 'No written comments from the room; marks are on the drawing.',
    ...comments.map((c, i) => `${i + 1}. ${c.page != null ? `p.${Number(c.page) + 1} ` : ''}${String(c.text ?? '')}${c.author ? ` — ${c.author}` : ''}${c.resolved ? ' (resolved)' : ''}`),
  ].filter(Boolean)
  await db.from('reviewer_notes').insert({
    document_version_id: dvId, batch_id: batchId, author_email: auth.email, author_name: auth.name ?? null, note_text: noteLines.join('\n'),
  }).then(() => null, () => null)

  await db.from('prelim_document').update({ handed_over_batch_id: batchId, handed_over_dv_id: dvId, handed_over_at: now, handed_over_by_email: auth.email }).eq('id', docId)
  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batchId, event_type: docno ? 'internal_drawing_submitted' : 'internal_review_submitted',
    actor_user_id: auth.userId, actor_email: auth.email, event_data: { via: 'prelim_review', prelimDocumentId: docId, sessionId: d.prelim_session.id, ref, fileName, fileSource, qualityOpen: qOpen },
  }).then(() => null, () => null)

  // Controller notification, as the front doors do (best-effort).
  try {
    const { data: setting } = await db.from('system_settings').select('value').eq('key', 'doc_request_controller_email').maybeSingle()
    const controller = splitEmails((setting as any)?.value); if (!controller.length) controller.push('mornec@ppetech.co.za')
    await sendMail({
      to: controller,
      subject: `From prelim review — ${ref} ready to assign reviewers`,
      htmlBody: brandedEmail({
        heading: 'A prelim-reviewed drawing is ready for internal review',
        bodyHtml: `<p><b>${auth.email}</b> handed over <b>${d.title ?? fileName}</b> from the session <b>${d.prelim_session.title}</b>.</p>
          <p style="margin:12px 0"><b>Ref:</b> ${ref}<br/><b>File:</b> ${fileName}<br/><b>Room's comments:</b> ${comments.length}<br/><b>Quality:</b> ${qOpen ? `<span style="color:#b45309">${qOpen} open issue${qOpen === 1 ? '' : 's'} carried into the review</span>` : d.quality_checked_at ? 'clear' : 'not checked'}</p>
          <p style="color:#6b7280;font-size:13px">The room's marks are in the file; its comments are the first handover note on the document.</p>`,
        cta: { href: `${APP_URL}/batches/${batchId}/assign`, label: 'Assign reviewers →' },
      }),
    })
  } catch {}

  return NextResponse.json({ ok: true, batchId, ref, fileName }, { status: 201 })
}
