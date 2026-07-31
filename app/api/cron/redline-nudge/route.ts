import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendMail } from '@/lib/coreflow-mail'

export const dynamic = 'force-dynamic'

// Weekly nudge (Mondays): each engineer with redlines awaiting their As-Built
// gets one email listing them — drafting can take weeks, memory shouldn't be
// the mechanism. Secret-gated like the other crons.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? req.nextUrl.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const db = createServiceClient()
  const { data: subs } = await db.from('redline_submission')
    .select('id, submitter_name, created_by_email, accepted_at, asbuilt_engineer_email')
    .eq('review_state', 'awaiting_asbuilt')
    .not('asbuilt_engineer_email', 'is', null)
  if (!subs?.length) return NextResponse.json({ nudged: 0 })

  const { data: docs } = await db.from('redline_document')
    .select('submission_id, drawing_number').in('submission_id', subs.map(s => s.id))
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

  const byEngineer = new Map<string, typeof subs>()
  for (const s of subs) {
    const k = s.asbuilt_engineer_email!
    if (!byEngineer.has(k)) byEngineer.set(k, [])
    byEngineer.get(k)!.push(s)
  }

  let nudged = 0
  for (const [engineer, items] of byEngineer) {
    const rows = items.map(s => {
      const nums = (docs ?? []).filter(d => d.submission_id === s.id).map(d => d.drawing_number).join(', ')
      const days = s.accepted_at ? Math.round((Date.now() - new Date(s.accepted_at).getTime()) / 86400000) : '?'
      return `<li><span style="font-family:monospace">${nums}</span> — accepted ${days} day(s) ago (redline by ${s.submitter_name ?? s.created_by_email})</li>`
    }).join('')
    try {
      await sendMail({
        to: engineer,
        subject: `CoreDocs — reminder: ${items.length} redline${items.length !== 1 ? 's' : ''} awaiting your As-Built`,
        htmlBody:
          `<p>These accepted redlines are still waiting for their corrected As-Built drawing:</p><ul>${rows}</ul>` +
          `<p><a href="${appUrl}/redlines/awaiting">Upload the As-Built →</a></p>` +
          `<p style="color:#6b7280;font-size:13px">You'll get this reminder weekly while any redline waits under your name.</p>`,
      })
      nudged++
    } catch (e) { console.warn('redline nudge failed for', engineer, e) }
  }
  return NextResponse.json({ nudged, engineers: [...byEngineer.keys()] })
}
