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
 * A route handler (not a server action) so large drawing files aren't capped by the
 * server-action body limit.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPermissions, can, FK } from '@/lib/permissions'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { uploadBytesToLibrary } from '@/lib/services/graph'

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const role = (profile?.role ?? 'reviewer') as string
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_SUBMIT_INTERNAL_DRAWING, role))
    return NextResponse.json({ error: 'Not authorised to submit an internal drawing.' }, { status: 403 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  const lineId = String(form.get('lineId') ?? '')
  if (!lineId) return NextResponse.json({ error: 'Missing request line.' }, { status: 400 })
  if (!file || file.size === 0) return NextResponse.json({ error: 'Choose a drawing file to upload.' }, { status: 400 })

  const svc = createServiceClient()

  // ─── Load the allocated request line ──────────────────────────────────────
  const { data: line } = await svc.from('document_number_request_line')
    .select('id, request_id, rdmc_document_number, full_title, discipline_code, document_type_code, revision, linked_document_id, title1, title2, title3')
    .eq('id', lineId).single()
  if (!line) return NextResponse.json({ error: 'Request line not found.' }, { status: 404 })
  if (!line.rdmc_document_number)
    return NextResponse.json({ error: 'This line has no allocated number yet — Document Control must allocate it first.' }, { status: 400 })
  if (line.linked_document_id)
    return NextResponse.json({ error: 'A drawing has already been submitted for this line.' }, { status: 409 })

  const { data: reqHdr } = await svc.from('document_number_request')
    .select('id, package_id').eq('id', line.request_id).single()

  // ─── Confirm the file's number against the allocated number ──────────────
  const parsed = parseDocumentFileName(file.name)
  if (norm(parsed.normalizedDocumentNumber) !== norm(line.rdmc_document_number)) {
    return NextResponse.json({
      error: `The file's number (${parsed.displayDocumentNumber}) does not match the allocated number (${line.rdmc_document_number}). Rename the file to ${line.rdmc_document_number}_${line.revision ?? 'A'}.pdf and try again.`,
    }, { status: 422 })
  }
  const revision = parsed.revision ?? line.revision ?? 'A'
  const title = line.full_title ?? ([line.title1, line.title2, line.title3].filter(Boolean).join(' — ') || null)

  // ─── Store the review copy in SharePoint ─────────────────────────────────
  let centralUrl: string
  try {
    const bytes = await file.arrayBuffer()
    const up = await uploadBytesToLibrary(file.name, bytes, file.type || 'application/pdf')
    centralUrl = up.webUrl
  } catch (e: any) {
    return NextResponse.json({ error: `Upload to SharePoint failed: ${e?.message ?? e}` }, { status: 502 })
  }

  // ─── Create batch (source='internal') + document + version, link the line ─
  const { data: batch, error: be } = await svc.from('batches').insert({
    batch_guid:      randomUUID(),
    source:          'internal',
    request_line_id: line.id,
    package_id:      reqHdr?.package_id ?? null,
    status:          'metadata_pending',
    file_count:      1,
    received_at:     new Date().toISOString(),
  }).select('id').single()
  if (be || !batch) return NextResponse.json({ error: be?.message ?? 'Could not create batch.' }, { status: 500 })

  const { data: doc, error: de } = await svc.from('documents').insert({
    normalized_document_number: line.rdmc_document_number,
    display_document_number:    line.rdmc_document_number,
    title,
    package_id:    reqHdr?.package_id ?? null,
    discipline:    line.discipline_code ?? null,
    document_type: line.document_type_code ?? null,
  }).select('id').single()
  if (de || !doc) return NextResponse.json({ error: de?.message ?? 'Could not create document.' }, { status: 500 })

  const { data: dv, error: ve } = await svc.from('document_versions').insert({
    document_id:        doc.id,
    batch_id:           batch.id,
    file_name:          file.name,
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
    entity_type: 'batch', entity_id: batch.id, event_type: 'internal_drawing_submitted',
    actor_user_id: profile?.id ?? null, actor_email: profile?.email ?? null,
    event_data: { rdmc: line.rdmc_document_number, revision, fileName: file.name, requestId: line.request_id },
  })

  return NextResponse.json({
    success: true, batchId: batch.id, docNumber: line.rdmc_document_number, revision,
  }, { status: 201 })
}
