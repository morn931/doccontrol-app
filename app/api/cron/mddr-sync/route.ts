import { createServiceClient } from '@/lib/supabase/server'
import { syncProgress } from '@/lib/mddr/sync'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Daily automatic MDDR progress sync (Vercel Cron — see vercel.json), running after
 * the SharePoint intake sync. Carries the latest review status into the MDDR master,
 * applies the Rules of Credit, and reconciles each row's revision to the file on
 * record (Option C — register forward/IFC target → target_revision). Previously the
 * sync was manual-only (the "Sync Progress" button on /mddr).
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`; we verify it so the endpoint
 * can't be triggered by the public. Also callable manually with the same header.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const db = createServiceClient()
  try {
    const r = await syncProgress(db)
    return NextResponse.json({
      ok: true, ranAt: new Date().toISOString(),
      matched: r.matched, updated: r.updated, skipped: r.skipped,
      live_versions_indexed: r.liveVersionsIndexed, errors: r.errors,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
