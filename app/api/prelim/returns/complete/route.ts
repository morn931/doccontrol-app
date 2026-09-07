import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { prelimAuth, isErr } from '@/lib/prelim'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

// Step 2 of a return: the corrected file is in SharePoint. Make it the drawing's working
// copy, archive what was sent out (the call, the marks, the comments) into routing_history,
// and unlock the three before-tender buttons so the reviewer can make the next call.
// The person who sent it out is told it is back.
//
// Body: { docId, webUrl, fileName }
export async function POST(req: Request) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const body = await req.json().catch(() => ({}))
  const docId = String(body?.docId ?? ''), webUrl = String(body?.webUrl ?? ''), fileName = String(body?.fileName ?? '')
  if (!docId || !webUrl.startsWith('https://') || !fileName) return NextResponse.json({ error: 'Missing upload details.' }, { status: 400 })

  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document').select('*, prelim_session!inner(id, title, status)').eq('id', docId).maybeSingle()
  const d = doc as any
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (d.prelim_session.status !== 'open') return NextResponse.json({ error: 'This session is closed.' }, { status: 409 })

  const now = new Date().toISOString()
  const from = d.routing === 'drawing_office' || d.routing === 'lead' ? d.routing : (d.returned_from ?? null)
  const history: any[] = Array.isArray(d.routing_history) ? d.routing_history : []
  history.push({
    at: now, event: 'returned', by: auth.email, file: fileName, file_url: webUrl,
    was: d.routing ? { routing: d.routing, to: d.routing_to_email, to_name: d.routing_to_name, at: d.routing_at, by: d.routing_by_email, mailed_at: d.routing_mailed_at } : null,
    marked_copy: d.working_file_url, comments: Array.isArray(d.markup_comments) ? d.markup_comments : [],
  })
  const { error } = await db.from('prelim_document').update({
    returned_at: now, returned_by_email: auth.email, returned_from: from, returned_file_name: fileName, returned_file_url: webUrl,
    prior_working_file_url: d.working_file_url, working_file_url: webUrl, working_file_name: fileName,
    markup_layer: null, markup_comments: null, markup_committed_at: null,
    routing: null, routing_at: null, routing_by_email: null, routing_to_email: null, routing_to_name: null, routing_mailed_at: null, routing_attached: null, routing_error: null,
    routing_history: history,
  }).eq('id', docId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await db.from('audit_events').insert({
    entity_type: 'prelim_document', entity_id: docId, event_type: 'prelim_returned',
    actor_user_id: auth.userId, actor_email: auth.email,
    event_data: { sessionId: d.prelim_session.id, document: d.document_number ?? d.source_file_name, fileName, from, wasSentTo: d.routing_to_email ?? null },
  }).then(() => null, () => null)

  // Tell the reviewer who sent it out that it is back (best-effort).
  const notify = d.routing_by_email && d.routing_by_email !== auth.email ? d.routing_by_email : null
  if (notify) {
    try {
      await sendMail({
        to: notify,
        subject: `Back from ${from === 'lead' ? 'the lead engineer' : 'the drawing office'} — ${d.document_number ?? d.title ?? fileName}`,
        htmlBody: brandedEmail({
          heading: 'A corrected drawing is back',
          bodyHtml: `<p><b>${d.document_number ?? d.title ?? fileName}</b> has been returned${from ? ` from ${from === 'lead' ? 'the lead engineer' : 'the drawing office'}` : ''} by ${auth.name ?? auth.email} and is now the working copy in the session <b>${d.prelim_session.title}</b>.</p><p>Open it, check the corrections, and make the next call — Ready for tender, or send it out again.</p>`,
          cta: { href: `${APP_URL}/prelim/${d.prelim_session.id}/doc/${docId}`, label: 'Open the drawing →' },
        }),
      })
    } catch {}
  }
  return NextResponse.json({ ok: true, docId, sessionId: d.prelim_session.id, notified: notify })
}
