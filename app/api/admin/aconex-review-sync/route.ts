import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runAconexReviewSync } from '@/lib/aconex-review/sync'

export const runtime = 'nodejs'
export const maxDuration = 300

// Manual "sync now" for the Aconex Review Tracker — same code path as the nightly
// cron, for an admin/developer who does not want to wait for 03:30. Body (optional):
//   { "dryRun": true, "packages": ["K124"], "budgetMs": 120000 }
// dryRun reads Aconex and reports what WOULD change without writing anything.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = (profile as { role?: string } | null)?.role
  if (role !== 'admin' && role !== 'developer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { dryRun?: boolean; packages?: string[]; budgetMs?: number } = {}
  try { body = await req.json() } catch {}
  const budgetMs = Math.min(275_000, Math.max(20_000, Number(body.budgetMs) || 275_000))
  const packages = Array.isArray(body.packages) ? body.packages.filter(p => typeof p === 'string') : undefined

  try {
    const result = await runAconexReviewSync(createServiceClient(), { budgetMs, packages, dryRun: !!body.dryRun })
    return NextResponse.json({ ok: !result.packages.some(p => p.error), triggeredBy: user.email, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
