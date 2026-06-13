import { createClient, createServiceClient } from '@/lib/supabase/server'
import { syncFromSharePoint } from '@/lib/import/sharepoint-sync'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// Manual "Sync now" — reads the SharePoint lists directly via Graph and imports.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const mode = (body?.mode === 'dry_run' || body?.mode === 'incremental') ? body.mode : 'full'

  const db = createServiceClient()
  try {
    const results = await syncFromSharePoint(db, { mode })
    return NextResponse.json({ ok: true, mode, results })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
