import { createServiceClient } from '@/lib/supabase/server'
import { syncFromSharePoint } from '@/lib/import/sharepoint-sync'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Daily automatic SharePoint sync (Vercel Cron — see vercel.json).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`; we verify it so the
 * endpoint can't be triggered by the public.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const db = createServiceClient()
  try {
    // Incremental keeps the daily run light (only items changed since last sync).
    const results = await syncFromSharePoint(db, { mode: 'incremental' })
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
