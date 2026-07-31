import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'

export const dynamic = 'force-dynamic'

// Daily review hygiene (2026-07-31) — overdue stops being cosmetic:
//  1. Armed tasks past their due date flip to status 'overdue' (honest state).
//  2. Each reviewer with overdue tasks gets ONE chase email listing them.
//  3. The Document Controller gets a digest: overdue reviews, chains on hold
//     ("needs more review"), and vendor batches whose transmittal went out
//     days ago without the vendor-return confirmation coming back.
const ARMED = ['sent', 'opened', 'in_progress']

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? req.nextUrl.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const db = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

  // 1) Flip newly-overdue tasks.
  const { data: flipped } = await db.from('review_tasks')
    .update({ status: 'overdue', updated_at: new Date().toISOString() })
    .in('status', ARMED).lt('due_date', today)
    .select('id')

  // 2) Everything currently overdue → chase each reviewer once.
  const { data: overdue } = await db.from('review_tasks')
    .select('id, reviewer_email, due_date, batch_id, document_versions(file_name)')
    .eq('status', 'overdue')
    .order('due_date', { ascending: true })
    .limit(500)

  const byReviewer = new Map<string, any[]>()
  for (const t of (overdue ?? [])) {
    const k = (t.reviewer_email ?? '').toLowerCase()
    if (!k) continue
    if (!byReviewer.has(k)) byReviewer.set(k, [])
    byReviewer.get(k)!.push(t)
  }
  let chased = 0
  for (const [reviewer, tasks] of byReviewer) {
    const rows = tasks.map(t => {
      const days = Math.max(1, Math.round((Date.now() - new Date(t.due_date).getTime()) / 86400000))
      return `<li><a href="${appUrl}/reviews/${t.id}"><span style="font-family:monospace">${(t.document_versions as any)?.file_name ?? 'document'}</span></a> — due ${t.due_date}, <b>${days} day(s) overdue</b></li>`
    }).join('')
    try {
      await sendEmail({
        to: reviewer,
        subject: `[Overdue] ${tasks.length} review${tasks.length !== 1 ? 's' : ''} waiting on you`,
        htmlBody: `<p>These reviews are past their due date — the chain is waiting on you:</p><ul>${rows}</ul>` +
                  `<p><a href="${appUrl}/reviews">Open My Reviews →</a></p>`,
      })
      chased++
    } catch (e) { console.warn('overdue chase failed for', reviewer, e) }
  }

  // 3) Controller digest.
  const { data: nmr } = await db.from('review_tasks')
    .select('reviewer_email, batch_id, updated_at, document_versions(file_name)')
    .eq('status', 'needs_more_review').limit(100)
  const staleCutoff = new Date(Date.now() - 3 * 86400000).toISOString()
  const { data: staleReturns } = await db.from('batches')
    .select('id, batch_guid, updated_at, packages(package_name)')
    .eq('source', 'vendor').eq('status', 'transmittal_generated')
    .lt('updated_at', staleCutoff).limit(100)

  const hasAnything = (overdue?.length ?? 0) + (nmr?.length ?? 0) + (staleReturns?.length ?? 0) > 0
  if (hasAnything) {
    const { data: dcSetting } = await db.from('system_settings')
      .select('value').eq('key', 'doc_request_controller_email').maybeSingle()
    const controller = (((dcSetting as any)?.value as string | undefined)?.trim() || 'mornec@ppetech.co.za')
      .split(/[;,]/).map((e: string) => e.trim()).filter(Boolean)
    const sec = (title: string, items: string[]) =>
      items.length ? `<p style="margin:14px 0 4px"><b>${title}</b></p><ul>${items.join('')}</ul>` : ''
    try {
      await sendEmail({
        to: controller,
        subject: `[CoreDocs daily digest] ${overdue?.length ?? 0} overdue · ${nmr?.length ?? 0} on hold · ${staleReturns?.length ?? 0} unconfirmed returns`,
        htmlBody:
          sec(`Overdue reviews (${overdue?.length ?? 0})`, (overdue ?? []).slice(0, 30).map(t =>
            `<li><span style="font-family:monospace">${(t.document_versions as any)?.file_name ?? ''}</span> — ${t.reviewer_email}, due ${t.due_date} · <a href="${appUrl}/batches/${t.batch_id}">batch</a></li>`)) +
          sec(`Chains on hold — needs more review (${nmr?.length ?? 0})`, (nmr ?? []).map(t =>
            `<li><span style="font-family:monospace">${(t.document_versions as any)?.file_name ?? ''}</span> — flagged by ${t.reviewer_email} · <a href="${appUrl}/batches/${t.batch_id}">batch</a></li>`)) +
          sec(`Transmittal sent, vendor return not confirmed after 3+ days (${staleReturns?.length ?? 0})`, (staleReturns ?? []).map(b =>
            `<li>${(b.packages as any)?.package_name ?? 'Unknown package'} · <a href="${appUrl}/batches/${b.id}">batch ${String(b.batch_guid ?? '').slice(0, 8)}…</a> — check the return Logic App / vendor library</li>`)) +
          `<p style="color:#6b7280;font-size:13px">Sent daily while anything is outstanding.</p>`,
      })
    } catch (e) { console.warn('controller digest failed', e) }
  }

  return NextResponse.json({
    flippedOverdue: flipped?.length ?? 0, chasedReviewers: chased,
    overdueTasks: overdue?.length ?? 0, onHold: nmr?.length ?? 0, staleReturns: staleReturns?.length ?? 0,
  })
}
