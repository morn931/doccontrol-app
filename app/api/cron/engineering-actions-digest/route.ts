import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'

export const dynamic = 'force-dynamic'

// Daily Engineering Action Register digest (EM's preference, 2026-08: no instant per-action
// emails). One email per person who has either:
//   • open / in-progress actions assigned to them, or
//   • actions THEY raised that got a new answer in the last day (the loop-closer),
// with their count and a one-click link into the register.
const OPEN = ['open', 'in_progress']

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? req.nextUrl.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const db = createServiceClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'
  const nowIso = new Date().toISOString()
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

  // 1) Open actions per assignee. ONLY live/confirmed actions — never AI-suggested ones
  // ("Confirm → live" sets suggested=false). Per-action WEEKLY cadence: an action is (re)sent to
  // its assignee only once it's been ≥7 days since it was last emailed (or never). Uses select('*')
  // + a JS filter so it degrades gracefully until migration 040 adds last_digest_emailed_at — until
  // then every action is "due" and it behaves like the previous digest.
  const { data: openAll } = await db.from('engineering_action')
    .select('*')
    .in('status', OPEN).eq('suggested', false).not('assigned_to_email', 'is', null).limit(5000)
  const open = (openAll ?? []).filter((a: any) => !a.last_digest_emailed_at || a.last_digest_emailed_at < weekAgo)

  // 2) New answers (last 24h) on actions the recipient RAISED — replies not by the raiser.
  const { data: replies } = await db.from('engineering_action_reply')
    .select('author_email, author_name, body, created_at, engineering_action(action_ref, description, raised_by_email)')
    .gte('created_at', dayAgo).order('created_at', { ascending: false }).limit(2000)

  type Bucket = { assigned: any[]; answers: any[] }
  const people = new Map<string, Bucket>()
  const bucket = (email: string) => { const k = email.toLowerCase(); if (!people.has(k)) people.set(k, { assigned: [], answers: [] }); return people.get(k)! }

  for (const a of (open ?? [])) if (a.assigned_to_email) bucket(a.assigned_to_email).assigned.push(a)
  for (const r of (replies ?? [])) {
    const act = (r as any).engineering_action
    if (!act?.raised_by_email) continue
    if (String(r.author_email ?? '').toLowerCase() === String(act.raised_by_email).toLowerCase()) continue // own follow-up
    bucket(act.raised_by_email).answers.push({ ...act, by: (r as any).author_name || r.author_email, body: r.body })
  }

  const li = (s: string) => `<li>${s}</li>`
  let sent = 0
  const stampIds: string[] = []   // actions actually emailed this run → reset their weekly clock
  for (const [email, b] of people) {
    if (!b.assigned.length && !b.answers.length) continue
    const assignedRows = b.assigned.slice(0, 25).map((a: any) =>
      li(`<span style="font-family:monospace">${a.action_ref}</span>${a.priority ? ` <b>[${a.priority}]</b>` : ''} — ${a.description}${a.document_number ? ` <span style="color:#6b7280">(${a.document_number})</span>` : ''}`)).join('')
    const answerRows = b.answers.slice(0, 25).map((a: any) =>
      li(`<span style="font-family:monospace">${a.action_ref}</span> — <b>${a.by}</b> answered: “${a.description}”`)).join('')
    const sec = (title: string, rows: string) => rows ? `<p style="margin:14px 0 4px"><b>${title}</b></p><ul>${rows}</ul>` : ''
    try {
      await sendEmail({
        to: email,
        subject: `[Engineering actions] ${b.assigned.length} on you${b.answers.length ? ` · ${b.answers.length} new answer${b.answers.length !== 1 ? 's' : ''}` : ''}`,
        htmlBody:
          `<p>Your Engineering Action Register summary:</p>` +
          sec(`Open actions assigned to you (${b.assigned.length})`, assignedRows) +
          sec(`New answers on actions you raised (${b.answers.length})`, answerRows) +
          `<p><a href="${appUrl}/engineering-actions">Open the Engineering Action Register →</a></p>` +
          `<p style="color:#6b7280;font-size:13px">Each open action is re-sent about once a week until you clear or reply to it in the register.</p>`,
      })
      sent++
      for (const a of b.assigned) if (a.id) stampIds.push(a.id)
    } catch (e) { console.warn('eng-action digest failed for', email, e) }
  }

  // Reset the weekly clock on every action we just emailed, so it isn't re-sent for ~7 days.
  // Wrapped: last_digest_emailed_at doesn't exist until migration 040 is applied — until then this
  // no-ops and the digest keeps its old daily cadence.
  let stamped = 0
  if (stampIds.length) {
    const { error } = await db.from('engineering_action').update({ last_digest_emailed_at: nowIso }).in('id', stampIds)
    if (error) console.warn('eng-action digest: could not stamp last_digest_emailed_at (migration 040 not applied?)', error.message)
    else stamped = stampIds.length
  }

  return NextResponse.json({ recipients: sent, dueActions: open.length, stamped, newAnswers: replies?.length ?? 0 })
}
