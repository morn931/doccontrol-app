import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { buildTracker, type PackageStat } from '@/lib/reporting/engineering-tracker'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const db: any = createServiceClient()
  const url = new URL(req.url)
  const periodEnd = url.searchParams.get('periodEnd') || new Date().toISOString().slice(0, 10)
  const pctBasis = (url.searchParams.get('basis') === 'docs' ? 'docs' : 'hours') as 'docs' | 'hours'

  // Aggregate awarded MDDR rows per package.
  type Acc = { active: number; approved: number; prog: number; planned: number }
  const acc: Record<string, Acc> = {}
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('mddr_entries')
      .select('package_code, progress_percent, review_outcome_code, planned_completion_date')
      .eq('is_active', true).eq('is_awarded', true)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const r of data ?? []) {
      const code = r.package_code
      if (!code) continue
      const a = (acc[code] ??= { active: 0, approved: 0, prog: 0, planned: 0 })
      a.active++
      a.prog += Number(r.progress_percent ?? 0)
      if (r.review_outcome_code === 'A1') a.approved++
      if (r.planned_completion_date && r.planned_completion_date <= periodEnd) a.planned++
    }
    if (!data || data.length < 1000) break
  }

  const stats: Record<string, PackageStat> = {}
  for (const [code, a] of Object.entries(acc)) {
    const actualPct  = a.active ? a.prog / a.active / 100 : 0
    const plannedPct = a.active ? a.planned / a.active : 0
    stats[code] = {
      activeDocs: a.active, approvedDocs: a.approved,
      actualPct, plannedPct, periodPct: 0,
      note: `${a.active} docs; ${a.approved} approved (A1); planned ${(plannedPct * 100).toFixed(1)}%; actual ${(actualPct * 100).toFixed(1)}%`,
    }
  }

  const { rows, grand } = buildTracker(stats, { pctBasis })
  return NextResponse.json({ rows, grand, periodEnd, basis: pctBasis, generatedAt: new Date().toISOString() })
}
