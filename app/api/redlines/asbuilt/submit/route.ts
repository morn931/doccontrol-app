import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { sendMail } from '@/lib/coreflow-mail'

// The engineer submits the drafted As-Built pack: creates a batches row
// (source='asbuilt', metadata_pending) hard-linked to the redline, so it lands
// at the Document Controller's door with the 📐 AS-BUILT badge for routing.
// files = [{ drawingNumber, fileName, spFileUrl, revision }] — one per redline drawing.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { submissionId, files } = await req.json()
  if (!submissionId || !Array.isArray(files) || !files.length) {
    return NextResponse.json({ error: 'submissionId and files are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: s } = await db.from('redline_submission')
    .select('id, review_state, asbuilt_engineer_email, submitter_name, created_by_email, batch_id')
    .eq('id', submissionId).maybeSingle()
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (s.asbuilt_engineer_email !== user.email) return NextResponse.json({ error: 'This redline is not awaiting your As-Built' }, { status: 403 })
  if (s.review_state !== 'awaiting_asbuilt') return NextResponse.json({ error: `Redline is ${s.review_state}, not awaiting an As-Built` }, { status: 409 })

  // Every file must carry its drawing number in the filename (same guard as
  // the internal driveway — no mystery files).
  for (const f of files) {
    const norm = String(f.drawingNumber ?? '').trim().toUpperCase().replace(/\s+/g, '')
    if (!norm || !String(f.fileName ?? '').toUpperCase().includes(norm) || !f.spFileUrl) {
      return NextResponse.json(
        { error: `File "${f.fileName ?? '?'}" must be uploaded and its name must contain the drawing number ${f.drawingNumber ?? ''}.` },
        { status: 422 })
    }
  }

  const nowIso = new Date().toISOString()
  const { data: batch, error: be } = await db.from('batches').insert({
    batch_guid:  `ASBUILT-${randomUUID()}`,
    source:      'asbuilt',
    status:      'metadata_pending',
    file_count:  files.length,
    received_at: nowIso,
    vendor_email: user.email,
    comments:    `AS-BUILT from ${user.email} — answers the site redline submitted by ${s.submitter_name ?? s.created_by_email}.`,
  }).select('id').single()
  if (be || !batch) return NextResponse.json({ error: be?.message ?? 'Could not create batch' }, { status: 500 })

  for (const f of files) {
    const parsed = parseDocumentFileName(f.fileName)
    const { error: ve } = await db.from('document_versions').insert({
      batch_id:           batch.id,
      file_name:          f.fileName,
      revision:           f.revision || parsed.revision,
      revision_sort:      parsed.revisionSort,
      central_file_url:   f.spFileUrl,
      storage_provider:   'sharepoint',
      doc_name:           `As-Built — ${f.drawingNumber}`,
      ai_metadata_source: 'asbuilt_upload',
      status:             'uploaded',
      is_latest:          true,
    })
    if (ve) return NextResponse.json({ error: ve.message }, { status: 500 })
  }

  await db.from('redline_submission').update({ asbuilt_batch_id: batch.id }).eq('id', submissionId)
  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batch.id, event_type: 'asbuilt_submitted',
    actor_email: user.email,
    event_data: { submissionId, redlineBatchId: s.batch_id, files: files.map((f: any) => f.fileName) },
  })

  try {
    const { data: setting } = await db.from('system_settings')
      .select('value').eq('key', 'doc_request_controller_email').maybeSingle()
    const controller = (setting?.value ?? 'mornec@ppetech.co.za').split(/[;,]/).map((x: string) => x.trim()).filter(Boolean)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'
    await sendMail({
      to: controller,
      subject: `CoreDocs — 📐 AS-BUILT submitted (${files.length} drawing${files.length !== 1 ? 's' : ''})`,
      htmlBody:
        `<p><b>${user.email}</b> uploaded the drafted As-Built for the site redline by ${s.submitter_name ?? s.created_by_email} — route it for the closing check.</p>` +
        `<ul>${files.map((f: any) => `<li style="font-family:monospace">${f.fileName}</li>`).join('')}</ul>` +
        `<p><a href="${appUrl}/batches/${batch.id}">Open the batch → assign reviewers</a></p>`,
    })
  } catch (e) { console.warn('asbuilt submit email failed', e) }

  return NextResponse.json({ success: true, batchId: batch.id })
}
