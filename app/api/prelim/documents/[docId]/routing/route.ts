import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getFileBytesByUrl, uploadBytesBesideItem, deleteDriveItemByUrl } from '@/lib/services/graph'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { prelimAuth, isErr, drawingOfficeEmail, listPeople, resolveLead, type Person } from '@/lib/prelim'
import { stampIssuedForTender, tenderCopyName } from '@/lib/prelim/tender-stamp'

/** Subfolder beside the source file in COLAB that holds the stamped copies. */
const TENDER_FOLDER = process.env.PRELIM_TENDER_FOLDER || 'Issued for Tender'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'
// Graph's simple fileAttachment tops out around 3 MB; above that the mail carries a link.
const ATTACH_LIMIT = 3 * 1024 * 1024
export const maxDuration = 60

type Action = 'drawing_office' | 'lead' | 'ready_for_tender'
const isDoText = (a: string) => a === 'drawing_office' ? 'drawing office' : 'engineer'
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// Where a prelim-reviewed drawing goes next (migration 053). For the tender push this is
// THE review before the documents go out, so the reviewer makes one of three calls on the
// drawing itself:
//   drawing_office    mail the marked-up PDF to the drawing office (+ the quality issues)
//   lead              mail it to the PPE responsible person — the CDDL doc owner where that
//                     resolves to one user, otherwise the reviewer picks (409 needLead)
//   ready_for_tender  mark only
// One call per drawing; DELETE (manage) undoes it.
//
// Body: { action, toEmail?, toName? }
export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const { docId } = await params
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action ?? '') as Action
  if (!['drawing_office', 'lead', 'ready_for_tender'].includes(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })

  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document').select('*, prelim_session!inner(id, title, status, area)').eq('id', docId).maybeSingle()
  const d = doc as any
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (d.prelim_session.status !== 'open') return NextResponse.json({ error: 'This session is closed.' }, { status: 409 })
  if (d.routing) return NextResponse.json({ error: 'A call has already been made on this drawing.', routing: d.routing }, { status: 409 })

  const label = d.document_number ?? d.title ?? d.source_file_name
  const now = new Date().toISOString()

  if (action === 'ready_for_tender') {
    // The stamped copy: every page marked ISSUED FOR TENDER ONLY + today's date, filed
    // beside the source in COLAB under "Issued for Tender". The working copy is untouched.
    let stamp: { name: string; url: string; pages: number } | null = null, stampErr: string | null = null
    try {
      const src = await getFileBytesByUrl(d.working_file_url)
      const { bytes, pages } = await stampIssuedForTender(src)
      const name = tenderCopyName(d.source_file_name.replace(/\.[^.]+$/, '.pdf'))
      const up = await uploadBytesBesideItem(d.source_file_url, TENDER_FOLDER, name, bytes)
      stamp = { name, url: up.webUrl, pages }
    } catch (e: any) { stampErr = e?.message ?? String(e) }
    await db.from('prelim_document').update({
      routing: action, routing_at: now, routing_by_email: auth.email, routing_to_email: null, routing_to_name: null, routing_mailed_at: null, routing_attached: null, routing_error: null,
      tender_stamped_at: stamp ? now : null, tender_stamped_file_name: stamp?.name ?? null, tender_stamped_file_url: stamp?.url ?? null, tender_stamp_error: stampErr,
    }).eq('id', docId)
    await audit(db, auth, docId, d, { action, tenderCopy: stamp?.url ?? null, tenderCopyPages: stamp?.pages ?? null, error: stampErr })
    if (stampErr) return NextResponse.json({ ok: false, routing: action, error: `Marked ready for tender, but the stamped copy could not be made: ${stampErr}` }, { status: 502 })
    return NextResponse.json({ ok: true, routing: action, tenderCopy: stamp })
  }

  // The mail carries the drawing WITH the marks — so they must be in the file first.
  const layerHasMarks = d.markup_layer && typeof d.markup_layer === 'object' && Object.keys(d.markup_layer).length > 0
  if (layerHasMarks) return NextResponse.json({ error: 'The marks are not in the file yet — press "☁ Save to SharePoint" first, then send.' }, { status: 409 })

  // ── who ────────────────────────────────────────────────────────────────────────────
  let to: Person
  if (action === 'drawing_office') {
    const email = await drawingOfficeEmail()
    to = { email, name: (await listPeople()).find(p => p.email === email.toLowerCase())?.name ?? 'Drawing office', role: '' }
  } else {
    const people = await listPeople()
    const pickedEmail = String(body?.toEmail ?? '').trim().toLowerCase()
    if (pickedEmail) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pickedEmail)) return NextResponse.json({ error: 'That is not an email address.' }, { status: 400 })
      to = people.find(p => p.email === pickedEmail) ?? { email: pickedEmail, name: String(body?.toName ?? '').trim() || pickedEmail, role: '' }
    } else {
      // The PPE responsible person is the CDDL doc owner. Resolve it; never guess.
      let owner: string | null = null
      if (d.cddl_doc_id) { const { data: c } = await db.from('cddl_doc').select('doc_owner').eq('id', d.cddl_doc_id).maybeSingle(); owner = (c as any)?.doc_owner ?? null }
      else if (d.document_number) { const { data: c } = await db.from('cddl_doc').select('doc_owner').ilike('docno', d.document_number).limit(1).maybeSingle(); owner = (c as any)?.doc_owner ?? null }
      const { resolved, candidates } = resolveLead(owner, people)
      if (!resolved) {
        return NextResponse.json({
          needLead: true,
          reason: !owner ? (d.cddl_doc_id || d.document_number ? 'The CDDL has no responsible person on this document.' : 'This drawing is not on the CDDL, so there is no responsible person to look up.')
                         : candidates.length ? `The CDDL names "${owner}" — more than one person, or initials only. Choose who it goes to.` : `The CDDL names "${owner}", who has no CoreDocs account. Choose who it goes to.`,
          owner, candidates, people,
        }, { status: 409 })
      }
      to = resolved
    }
  }

  // ── the mail ───────────────────────────────────────────────────────────────────────
  const qIssues: any[] = Array.isArray(d.quality_latest?.issues) ? d.quality_latest.issues : []
  const qualityHtml = !d.quality_checked_at
    ? `<p style="color:#6b7280">The quality check has not been run on this drawing.</p>`
    : !qIssues.length
      ? `<p style="color:#047857">Quality check (${new Date(d.quality_checked_at).toLocaleDateString('en-GB')}): clear — no issues found.</p>`
      : `<p>Quality check (${new Date(d.quality_checked_at).toLocaleDateString('en-GB')}): <b>${qIssues.length} issue${qIssues.length === 1 ? '' : 's'}</b> found.</p>
         <table cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px;width:100%">
           <tr style="background:#f1f5f9"><th align="left">#</th><th align="left">Severity</th><th align="left">Page</th><th align="left">Issue</th><th align="left">Fix</th></tr>
           ${qIssues.map((i, k) => `<tr style="border-top:1px solid #e2e8f0;vertical-align:top"><td>${k + 1}</td><td>${esc(i.severity)}</td><td>${i.page != null ? esc(i.page) : ''}</td><td>${esc(i.description)}</td><td>${esc(i.fix)}</td></tr>`).join('')}
         </table>`
  const comments: any[] = d.markup_comments ?? []
  const commentsHtml = comments.length
    ? `<p style="margin-top:14px"><b>Mark-up notes on the PDF (${comments.length}):</b></p><ol style="font-size:13px;margin:4px 0 0 18px;padding:0">${comments.map(c => `<li>${c.page != null ? `p.${Number(c.page) + 1} — ` : ''}${esc(c.text)}${c.author ? ` <span style="color:#6b7280">(${esc(c.author)})</span>` : ''}</li>`).join('')}</ol>`
    : `<p style="color:#6b7280;margin-top:14px">The mark-ups are drawn on the attached PDF; there are no separate written notes.</p>`

  let bytes: ArrayBuffer | null = null, attachErr: string | null = null
  try { bytes = await getFileBytesByUrl(d.working_file_url) } catch (e: any) { attachErr = e?.message ?? String(e) }
  const attached = !!bytes && bytes.byteLength <= ATTACH_LIMIT
  const sizeMb = bytes ? (bytes.byteLength / 1048576).toFixed(1) : null
  const fileLine = attached
    ? `<p><b>Attached:</b> ${esc(d.working_file_name)}</p>`
    : bytes ? `<p><b>Drawing:</b> the marked-up PDF is ${sizeMb} MB, too large to attach — open it here: <a href="${esc(d.working_file_url)}">${esc(d.working_file_name)}</a></p>`
            : `<p style="color:#b45309"><b>Drawing:</b> the marked-up PDF could not be read for attachment (${esc(attachErr)}) — open it here: <a href="${esc(d.working_file_url)}">${esc(d.working_file_name)}</a></p>`

  // Notes to the drawing office / engineer: the field on the drawing page. The button sends
  // the latest text with the request; the saved column is the fallback.
  const noteText = (typeof body?.note === 'string' ? body.note : (d.outcome_note ?? '')).trim()
  if (typeof body?.note === 'string' && noteText !== (d.outcome_note ?? '').trim()) await db.from('prelim_document').update({ outcome_note: noteText || null }).eq('id', docId)
  const noteHtml = noteText
    ? `<p style="margin:14px 0 0"><b>Notes to the ${isDoText(action)}:</b></p><p style="margin:4px 0 0;white-space:pre-wrap;border-left:3px solid #0097A3;padding:6px 10px;background:#f0fdfa">${esc(noteText)}</p>`
    : ''
  const isDo = action === 'drawing_office'
  const heading = isDo ? 'Drawing requires mark-ups' : 'Prelim review — drawing for your attention'
  const opening = isDo
    ? `<p>Hi ${esc(to.name.split(' ')[0])},</p><p>Please find the drawing that requires mark-ups as per the PDF.</p>`
    : `<p>Hi ${esc(to.name.split(' ')[0])},</p><p>You are the responsible person for this drawing. Please find the drawing with the prelim review mark-ups as per the attached PDF, and the quality issues found on it below.</p>`
  const htmlBody = brandedEmail({
    heading,
    bodyHtml: `${opening}
      <p style="margin:12px 0"><b>Drawing:</b> ${esc(label)}${d.revision ? ` rev ${esc(d.revision)}` : ''}${d.title && d.document_number ? `<br/><b>Title:</b> ${esc(d.title)}` : ''}<br/><b>Prelim session:</b> ${esc(d.prelim_session.title)}${d.prelim_session.area ? ` (${esc(d.prelim_session.area)})` : ''}<br/><b>Reviewed by:</b> ${esc(auth.name ?? auth.email)}</p>
      ${fileLine}
      ${noteHtml}
      <h3 style="font-size:14px;margin:16px 0 6px">Quality issues found</h3>
      ${qualityHtml}
      ${commentsHtml}`,
    cta: { href: `${APP_URL}/prelim/${d.prelim_session.id}/doc/${docId}`, label: 'Open in CoreDocs →' },
  })

  let mailedAt: string | null = null, mailErr: string | null = null
  try {
    await sendMail({
      to: to.email, cc: auth.email,
      subject: `${isDo ? 'Drawing requires mark-ups' : 'Prelim review'} — ${label}`,
      htmlBody,
      attachments: attached && bytes ? [{ name: d.working_file_name, contentType: 'application/pdf', contentBytes: Buffer.from(bytes).toString('base64') }] : undefined,
    })
    mailedAt = new Date().toISOString()
  } catch (e: any) { mailErr = e?.message ?? String(e) }

  await db.from('prelim_document').update({
    routing: action, routing_at: now, routing_by_email: auth.email, routing_to_email: to.email, routing_to_name: to.name,
    routing_mailed_at: mailedAt, routing_attached: mailedAt ? attached : null, routing_error: mailErr,
  }).eq('id', docId)
  await audit(db, auth, docId, d, { action, to: to.email, mailed: !!mailedAt, attached, error: mailErr })

  if (mailErr) return NextResponse.json({ ok: false, routing: action, to, error: `Recorded, but the mail did not go: ${mailErr}` }, { status: 502 })
  return NextResponse.json({ ok: true, routing: action, to, attached, sizeMb })
}

// Undo — the wrong button was pressed. Manage only; the record of the send stays in the audit log.
export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('manage'); if (isErr(auth)) return auth
  const { docId } = await params
  const db = createServiceClient()
  const { data: d } = await db.from('prelim_document').select('routing, routing_to_email, tender_stamped_file_url, prelim_session!inner(id, title)').eq('id', docId).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // A wrong "Ready for tender" must not leave a stamped copy in COLAB for the pack to pick up.
  let removed: string | null = null
  if ((d as any).tender_stamped_file_url) { const r = await deleteDriveItemByUrl((d as any).tender_stamped_file_url); removed = r.status; if (!r.ok) return NextResponse.json({ error: `Could not remove the stamped tender copy from COLAB (${r.detail}). Delete it by hand, then undo again.` }, { status: 502 }) }
  await db.from('prelim_document').update({ routing: null, routing_at: null, routing_by_email: null, routing_to_email: null, routing_to_name: null, routing_mailed_at: null, routing_attached: null, routing_error: null, tender_stamped_at: null, tender_stamped_file_name: null, tender_stamped_file_url: null, tender_stamp_error: null }).eq('id', docId)
  await audit(db, auth, docId, d, { action: 'undo', was: (d as any).routing, wasTo: (d as any).routing_to_email, tenderCopyRemoved: removed })
  return NextResponse.json({ ok: true })
}

async function audit(db: any, auth: { userId: string; email: string }, docId: string, d: any, data: Record<string, unknown>) {
  await db.from('audit_events').insert({
    entity_type: 'prelim_document', entity_id: docId, event_type: 'prelim_routing',
    actor_user_id: auth.userId, actor_email: auth.email, event_data: { sessionId: d.prelim_session?.id, document: d.document_number ?? d.source_file_name, ...data },
  }).then(() => null, () => null)
}
