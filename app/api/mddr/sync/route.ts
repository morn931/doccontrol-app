/**
 * POST /api/mddr/sync
 *
 * Carries the latest review status from the live document-control system into the
 * MDDR master and applies the agreed Rules of Credit. See lib/mddr/sync.
 *
 * Body (optional): { "package_code": "K137" } to limit the sync to one package.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncProgress } from '@/lib/mddr/sync'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const db: any = createServiceClient()
  let body: any = {}
  try { body = await req.json() } catch {}

  try {
    const result = await syncProgress(db, { packageCode: body?.package_code })
    return NextResponse.json({
      matched: result.matched, updated: result.updated,
      live_versions_indexed: result.liveVersionsIndexed, errors: result.errors,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
