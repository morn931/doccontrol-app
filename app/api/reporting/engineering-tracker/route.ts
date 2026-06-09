import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { buildTracker, type PackageStat } from '@/lib/reporting/engineering-tracker'
import { aggregatePackages } from '@/lib/reporting/package-progress'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const db: any = createServiceClient()
  const url = new URL(req.url)
  const periodEnd = url.searchParams.get('periodEnd') || new Date().toISOString().slice(0, 10)
  const pctBasis = (url.searchParams.get('basis') === 'docs' ? 'docs' : 'hours') as 'docs' | 'hours'

  let agg
  try { agg = await aggregatePackages(db, periodEnd) }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }

  const stats: Record<string, PackageStat> = {}
  for (const p of agg.rows) {
    stats[p.packageCode] = {
      activeDocs: p.activeDocs, approvedDocs: p.approvedDocs,
      actualPct: p.actualProgressPct, plannedPct: p.plannedToDatePct, periodPct: p.actualThisPeriodPct,
      note: `${p.activeDocs} docs; ${p.approvedDocs} approved (A1); planned ${(p.plannedToDatePct * 100).toFixed(1)}%; actual ${(p.actualProgressPct * 100).toFixed(1)}%`,
    }
  }

  const { rows, grand } = buildTracker(stats, { pctBasis })
  return NextResponse.json({ rows, grand, periodEnd, basis: pctBasis, generatedAt: new Date().toISOString() })
}
