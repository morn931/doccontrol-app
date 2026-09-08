import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAconexReviewSync } from '@/lib/aconex-review/sync'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Nightly Aconex Review Tracker sync — Vercel Cron, see vercel.json (03:30 UTC).
 *
 * WHY. Until 2026-09-08 the tracker was fed only by a Python script chained onto the
 * Windows task "CoreCost Aconex PDN Scan" on Morné's laptop, so it refreshed only on
 * mornings that laptop happened to be on (nothing between 6 and 17 August, nothing
 * after 5 September). The Vercel cron CoreCost already had (/api/cron/aconex-sync)
 * is the PDN *correspondence* sync and never touched these tables.
 *
 * Runs here in CoreDocs, which owns the tables, and reads Aconex through CoreCost's
 * secret-gated /api/aconex/register so the Aconex OAuth integration stays in one
 * place. It acts as the same Aconex integration user every other Coreflow Aconex
 * job uses (ACONEX_SUB on CoreCost) — no interactive login, no laptop.
 *
 * Budgeted: every step draws from one deadline and the sync stops early rather than
 * being killed, so a run always writes an aconex_review_sync row (see lib/aconex-review/sync.ts).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const CEILING_MS = 300_000
  const RETURN_MARGIN_MS = 25_000
  try {
    const result = await runAconexReviewSync(createServiceClient(), { budgetMs: CEILING_MS - RETURN_MARGIN_MS })
    const failed = result.packages.some(p => p.error)
    return NextResponse.json({ ok: !failed, ...result }, { status: failed ? 500 : 200 })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[cron/aconex-review-sync] failed', error)
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}
