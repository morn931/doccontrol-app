import { createServiceClient } from '@/lib/supabase/server'
import { runIntakePoll } from '@/lib/intake/poller'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/cron/intake-poll
 *
 * In-app vendor intake poller (replaces the Power Automate per-vendor "small flows"). Polls each
 * vendor with `vendor_sites.new_intake_enabled = true` for new drop-off documents, groups them,
 * runs the pre-review AI, creates batches, and notifies the controller. Behind the per-vendor
 * flag, so it does nothing until a vendor is flipped on (ICTS first).
 *
 * Trigger-agnostic: fired by the Vercel cron (see vercel.json) OR any external scheduler that
 * sends `Authorization: Bearer <CRON_SECRET>` — minute-level polling needs a trigger that can
 * fire that often (Vercel Pro cron, an external cron service, etc.).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const db = createServiceClient()
  try {
    const summary = await runIntakePoll(db)
    return NextResponse.json({ ok: true, ...summary })
  } catch (e: any) {
    console.error('intake-poll error:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
