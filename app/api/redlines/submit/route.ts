import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { sendMail } from '@/lib/coreflow-mail'

// Submit the caller's draft redline basket: creates a real batches row
// (source='redline', status='metadata_pending') so it lands at the Document
// Controller's door in Incoming Batches with the SITE REDLINE flag, ready to
// route to an engineer. One document_versions row per redline document.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { submissionId } = await req.json()
  const db = createServiceClient()

  const { data: sub } = await db.from('redline_submission')
    .select('id, created_by_email, status, submitter_name').eq('id', submissionId).maybeSingle()
  if (!sub || sub.created_by_email !== user.email) return NextResponse.json({ error: 'Not your submission' }, { status: 403 })
  if (sub.status !== 'draft') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

  const { data: docs } = await db.from('redline_document')
    .select('*').eq('submission_id', submissionId).order('created_at', { ascending: true })
  if (!docs?.length) return NextResponse.json({ error: 'Add at least one redlined document before submitting.' }, { status: 400 })

  const nowIso = new Date().toISOString()
  const summary = docs.map(d =>
    `${d.drawing_number}: ${d.change_description || d.description || 'no change description'} (marked by ${d.marked_by ?? 'unknown'}${d.marked_date ? ` on ${d.marked_date}` : ''})`
  ).join('\n')

  const { data: batch, error: be } = await db.from('batches').insert({
    batch_guid:  `REDLINE-${randomUUID()}`,
    source:      'redline',
    status:      'metadata_pending',
    file_count:  docs.length,
    received_at: nowIso,
    vendor_email: user.email,
    comments:    `SITE REDLINE submission by ${sub.submitter_name ?? user.email}.\n${summary}`,
  }).select('id').single()
  if (be || !batch) return NextResponse.json({ error: be?.message ?? 'Could not create batch' }, { status: 500 })

  for (const d of docs) {
    const parsed = parseDocumentFileName(d.file_name ?? `${d.drawing_number}.pdf`)
    const { error: ve } = await db.from('document_versions').insert({
      batch_id:           batch.id,
      file_name:          d.file_name ?? `${d.drawing_number}.pdf`,
      revision:           parsed.revision,
      revision_sort:      parsed.revisionSort,
      central_file_url:   d.sp_file_url,
      storage_provider:   'sharepoint',
      doc_name:           d.description || d.drawing_number,
      topic:              d.change_description || null,
      ai_metadata_source: 'site_redline',
      status:             'uploaded',
      is_latest:          true,
    })
    if (ve) return NextResponse.json({ error: ve.message }, { status: 500 })
  }

  await db.from('redline_submission')
    .update({ status: 'submitted', batch_id: batch.id, submitted_at: nowIso })
    .eq('id', submissionId)
  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batch.id, event_type: 'redline_submitted',
    actor_email: user.email,
    event_data: { submissionId, documents: docs.map(d => d.drawing_number) },
  })

  // Best-effort controller notification — never fail the submission on email.
  try {
    const { data: setting } = await db.from('system_settings')
      .select('value').eq('key', 'doc_request_controller_email').maybeSingle()
    const controller = (setting?.value ?? 'mornec@ppetech.co.za').split(/[;,]/).map((s: string) => s.trim()).filter(Boolean)
    const rows = docs.map(d =>
      `<tr><td style="padding:4px 10px;border:1px solid #e5e7eb;font-family:monospace">${d.drawing_number}</td>` +
      `<td style="padding:4px 10px;border:1px solid #e5e7eb">${d.change_description || d.description || '—'}</td>` +
      `<td style="padding:4px 10px;border:1px solid #e5e7eb">${d.marked_by ?? '—'}</td></tr>`).join('')
    await sendMail({
      to: controller,
      subject: `CoreDocs — SITE REDLINE batch submitted (${docs.length} drawing${docs.length !== 1 ? 's' : ''})`,
      htmlBody:
        `<p><b>${sub.submitter_name ?? user.email}</b> submitted a site redline batch — route it to the responsible engineer.</p>` +
        `<table style="border-collapse:collapse;font-size:13px"><tr>` +
        `<th style="padding:4px 10px;border:1px solid #e5e7eb;text-align:left">Drawing</th>` +
        `<th style="padding:4px 10px;border:1px solid #e5e7eb;text-align:left">Change</th>` +
        `<th style="padding:4px 10px;border:1px solid #e5e7eb;text-align:left">Marked by</th></tr>${rows}</table>` +
        `<p><a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'}/batches/${batch.id}">Open the batch → assign reviewers</a></p>`,
    })
  } catch (e) { console.warn('redline submit email failed', e) }

  return NextResponse.json({ success: true, batchId: batch.id })
}
