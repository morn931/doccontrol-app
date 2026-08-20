/**
 * POST /api/documents/signoff-intake
 *
 * Finalise the DC's Sign-off Intake: create a CoreDocs document + version for a CDDL document
 * from the file the DC uploaded (downloaded from Aconex), and land it STRAIGHT AT SIGN-OFF —
 * review skipped, because it was already reviewed on Aconex. No document-request line needed;
 * the CDDL entry is the proof the document is real and managed. Gated by ACTION_APPROVE_SIGNOFF_ONLY.
 *
 * Body: { docId (cddl_doc id), fileName, spFileUrl, reason? }
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPermissions, can, FK } from '@/lib/permissions'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_APPROVE_SIGNOFF_ONLY, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Not authorised to send a document straight to sign-off.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const docId = String(body?.docId ?? '')
  const fileName = String(body?.fileName ?? '')
  const spFileUrl = String(body?.spFileUrl ?? '')
  const reason = String(body?.reason ?? '').trim() || 'Returned from Aconex for revision — already reviewed.'
  if (!docId) return NextResponse.json({ error: 'Pick a document from the CDDL first.' }, { status: 400 })
  if (!fileName || !spFileUrl) return NextResponse.json({ error: 'Upload did not complete — please try again.' }, { status: 400 })

  const db = createServiceClient()
  const { data: cddl } = await db.from('cddl_doc')
    .select('docno, ppe_docno, title, discipline, doc_type, revision, package_code').eq('id', docId).single()
  const c = cddl as any
  if (!c) return NextResponse.json({ error: 'That CDDL document was not found.' }, { status: 404 })

  const parsed = parseDocumentFileName(fileName)
  const revision = parsed.revision ?? c.revision ?? '0'
  const docno: string = c.docno

  // Map the CDDL package code (e.g. K124) to a package_id, if we track that package.
  let packageId: string | null = null
  if (c.package_code) {
    const { data: pkg } = await db.from('packages').select('id').eq('package_code', c.package_code).maybeSingle()
    packageId = (pkg as any)?.id ?? null
  }

  // Reuse an existing CoreDocs document for this number, else create one.
  const { data: existing } = await db.from('documents').select('id').eq('normalized_document_number', docno).maybeSingle()
  let docRowId: string
  if (existing) {
    docRowId = (existing as any).id
    await db.from('document_versions').update({ is_latest: false }).eq('document_id', docRowId)
  } else {
    const { data: created, error: de } = await db.from('documents').insert({
      normalized_document_number: docno,
      display_document_number:    docno,
      title:                      c.title ?? null,
      package_id:                 packageId,
      discipline:                 c.discipline ?? null,
      document_type:              c.doc_type ?? null,
    }).select('id').single()
    if (de || !created) return NextResponse.json({ error: de?.message ?? 'Could not create the document.' }, { status: 500 })
    docRowId = (created as any).id
  }

  const now = new Date().toISOString()
  const { data: batch, error: be } = await db.from('batches').insert({
    batch_guid:  randomUUID(),
    source:      'internal',
    package_id:  packageId,
    status:      'review_complete',       // the sign-off gate accepts this — ready for signatures
    file_count:  1,
    received_at: now,
    signoff_only:              true,
    signoff_only_reason:       reason,
    signoff_only_approved_by:  profile?.email ?? null,
    signoff_only_approved_at:  now,
  }).select('id').single()
  if (be || !batch) return NextResponse.json({ error: be?.message ?? 'Could not create the batch.' }, { status: 500 })

  const { data: dv, error: ve } = await db.from('document_versions').insert({
    document_id:        docRowId,
    batch_id:           (batch as any).id,
    file_name:          fileName,
    revision,
    revision_sort:      (parsed as any).revisionSort ?? revision,
    central_file_url:   spFileUrl,
    storage_provider:   'sharepoint',
    doc_name:           c.title ?? null,
    discipline:         c.discipline ?? null,
    document_type:      c.doc_type ?? null,
    ai_metadata_source: 'manually_confirmed',
    status:             'uploaded',
    is_latest:          true,
  }).select('id').single()
  if (ve || !dv) return NextResponse.json({ error: ve?.message ?? 'Could not create the document version.' }, { status: 500 })

  await db.from('documents').update({ current_version_id: (dv as any).id }).eq('id', docRowId)

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: (batch as any).id, event_type: 'signoff_only_uploaded',
    actor_user_id: profile?.id ?? null, actor_email: profile?.email ?? null,
    event_data: { docno, revision, fileName, reason, source: 'cddl' },
  })

  return NextResponse.json({ success: true, batchId: (batch as any).id, docNumber: docno, revision }, { status: 201 })
}
