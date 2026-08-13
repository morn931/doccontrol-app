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
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  // 1) Open actions per assignee. ONLY live/confirmed actions — never AI-suggested ones:
  // people should only be emailed once an action has been confirmed into the Register
  // ("Confirm → live" sets suggested=false), not while it's an un-triaged AI suggestion.
  const { data: open } = await db.from('engineering_action')
    .select('action_ref, description, document_number, priority, assigned_to_email')
    .in('status', OPEN).eq('suggested', false).not('assigned_to_email', 'is', null).limit(5000)

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
          `<p style="color:#6b7280;font-size:13px">Daily while you have anything outstanding. Please clear or reply in the register.</p>`,
      })
      sent++
    } catch (e) { console.warn('eng-action digest failed for', email, e) }
  }
  return NextResponse.json({ recipients: sent, openActions: open?.length ?? 0, newAnswers: replies?.length ?? 0 })
}
