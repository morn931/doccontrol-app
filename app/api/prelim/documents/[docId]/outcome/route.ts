import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'
import { prelimAuth, isErr } from '@/lib/prelim'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'
const OUTCOMES = ['pending', 'ready', 'rework', 'withdrawn'] as const

// The room's call on a drawing. "rework" also tells the engineer, with the comment list,
// so the drawing goes back to the source folder with what the room said attached to it.
// Body: { outcome, note?, reworkToEmail? }
export async function PATCH(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const { docId } = await params
  const body = await req.json().catch(() => ({}))
  const outcome = String(body?.outcome ?? '') as typeof OUTCOMES[number]
  if (!OUTCOMES.includes(outcome)) return NextResponse.json({ error: 'Outcome must be ready, rework, withdrawn or pending.' }, { status: 400 })
  const note = String(body?.note ?? '').trim() || null
  const reworkTo = String(body?.reworkToEmail ?? '').trim().toLowerCase() || null

  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document')
    .select('id, title, document_number, source_file_name, source_file_url, markup_comments, handed_over_batch_id, prelim_session!inner(id, title, status)')
    .eq('id', docId).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const s = (doc as any).prelim_session
  if (s?.status !== 'open') return NextResponse.json({ error: 'This session is closed.' }, { status: 409 })
  if ((doc as any).handed_over_batch_id) return NextResponse.json({ error: 'Already handed over to the formal review; the outcome is settled.' }, { status: 409 })
  if (outcome === 'rework' && reworkTo && !reworkTo.includes('@')) return NextResponse.json({ error: 'Enter the engineer\'s email address.' }, { status: 400 })

  const now = new Date().toISOString()
  const { error } = await db.from('prelim_document').update({
    outcome, outcome_note: note, outcome_by_email: auth.email, outcome_at: outcome === 'pending' ? null : now,
    ...(outcome === 'rework' && reworkTo ? { rework_to_email: reworkTo, rework_sent_at: now } : {}),
  }).eq('id', docId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Tell the engineer, best-effort: the outcome is recorded whether or not the mail goes.
  let mailed = false
  if (outcome === 'rework' && reworkTo) {
    const comments: any[] = (doc as any).markup_comments ?? []
    const list = comments.length
      ? `<ol style="padding-left:18px;color:#374151">${comments.map(c => `<li>${c.page != null ? `<span style="color:#6b7280">p.${Number(c.page) + 1}</span> ` : ''}${String(c.text ?? '').replace(/</g, '&lt;')}${c.author ? ` <span style="color:#9ca3af">— ${c.author}</span>` : ''}</li>`).join('')}</ol>`
      : `<p style="color:#6b7280">No written comments — the marks are on the drawing.</p>`
    try {
      await sendMail({
        to: [reworkTo],
        subject: `Rework before review — ${(doc as any).document_number ?? (doc as any).title ?? (doc as any).source_file_name}`,
        htmlBody: brandedEmail({
          heading: 'The prelim review asks for rework',
          bodyHtml: `<p>In <b>${s.title}</b> the room looked at <b>${(doc as any).title ?? (doc as any).source_file_name}</b>${(doc as any).document_number ? ` (${(doc as any).document_number})` : ''} and asked for rework before it goes into internal review.</p>
            ${note ? `<p style="margin:12px 0"><b>Note from the room:</b> ${note.replace(/</g, '&lt;')}</p>` : ''}
            <p style="margin:12px 0 4px"><b>Comments (${comments.length}):</b></p>${list}
            <p style="color:#6b7280;font-size:13px">The marked-up working copy is in the session below. Update the source file in its folder and it can be pulled again.</p>`,
          cta: { href: `${APP_URL}/prelim/${s.id}/doc/${docId}`, label: 'Open the marked-up drawing →' },
        }),
      })
      mailed = true
    } catch {}
  }
  await db.from('audit_events').insert({
    entity_type: 'prelim_document', entity_id: docId, event_type: 'prelim_outcome_set',
    actor_user_id: auth.userId, actor_email: auth.email, event_data: { outcome, note, reworkTo, mailed },
  }).then(() => null, () => null)
  return NextResponse.json({ ok: true, mailed })
}
