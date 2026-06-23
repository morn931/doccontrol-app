import { createClient, createServiceClient } from '@/lib/supabase/server'
import { processImport } from '@/lib/import/process'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { mode, source, csvData } = body
  if (!csvData) return NextResponse.json({ error: 'csvData is required' }, { status: 400 })

  const db = createServiceClient()

  const { data: run } = await db.from('import_runs').insert({
    source, mode: mode ?? 'dry_run', started_by: null, status: 'running',
  }).select().single()
  if (!run) return NextResponse.json({ error: 'Failed to create import run' }, { status: 500 })

  const result = await processImport(run.id, source, mode ?? 'dry_run', csvData, db)
  await logActivity({ area: 'admin', action: 'import.run', summary: `${source ?? 'csv'} · ${mode ?? 'dry_run'}`, email: user.email })
  return NextResponse.json({ runId: run.id, ...result }, { status: 200 })
}
