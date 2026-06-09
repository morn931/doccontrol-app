import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { aggregatePackages } from '@/lib/reporting/package-progress'

export const runtime = 'nodejs'
export const maxDuration = 120

const PERIOD_START = '2025-05-01'

function monthEnd(y: number, m: number) {       // m: 0-11
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
}

export async function GET() {
  const db: any = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  // ── Per-package (shared aggregator) → bars + variance ──
  let agg
  try { agg = await aggregatePackages(db, today) }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }

  const byPackage = agg.rows
    .filter(p => p.activeDocs > 0)
    .map(p => ({ package: p.packageCode, planned: +(p.plannedToDatePct * 100).toFixed(1), actual: +(p.actualProgressPct * 100).toFixed(1) }))
  const variance = agg.rows
    .filter(p => p.activeDocs > 0)
    .map(p => ({ package: p.packageCode, variance: +(p.variancePct * 100).toFixed(1) }))
    .sort((a, b) => a.variance - b.variance)

  // ── Per-doc pass: S-curve (planned-scope) + milestone mix ──
  const milestoneBuckets = { 'Not started': 0, 'Submitted (25%)': 0, 'Reviewed (75%)': 0, 'Accepted (85%)': 0, 'Final IFC/IFD (100%)': 0 }
  type Doc = { planned: string | null; earned: string | null; prog: number }
  const scope: Doc[] = []   // docs with a planned date (scheduled scope) for the S-curve
  let minDate = PERIOD_START

  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('mddr_entries')
      .select('progress_percent, planned_completion_date, actual_submission_date, actual_completion_date')
      .eq('is_active', true).eq('is_awarded', true)
      .order('id', { ascending: true }).range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const r of data ?? []) {
      const p = Number(r.progress_percent ?? 0)
      if (p <= 0) milestoneBuckets['Not started']++
      else if (p < 50) milestoneBuckets['Submitted (25%)']++
      else if (p < 82) milestoneBuckets['Reviewed (75%)']++
      else if (p < 100) milestoneBuckets['Accepted (85%)']++
      else milestoneBuckets['Final IFC/IFD (100%)']++

      if (r.planned_completion_date) {
        const earned = r.actual_completion_date || r.actual_submission_date || (p > 0 ? today : null)
        scope.push({ planned: r.planned_completion_date, earned, prog: p })
        if (r.planned_completion_date < minDate) minDate = r.planned_completion_date
      }
    }
    if (!data || data.length < 1000) break
  }

  // S-curve monthly series over the scheduled scope.
  const total = scope.length || 1
  const maxPlanned = scope.reduce((m, d) => (d.planned && d.planned > m ? d.planned : m), today)
  const start = new Date(minDate + 'T00:00:00Z')
  const endCap = new Date(Math.min(new Date(maxPlanned).getTime(), Date.parse(today) + 730 * 864e5))
  const end = new Date(Math.max(endCap.getTime(), Date.parse(today)))

  const scurve: { month: string; planned: number; actual: number | null }[] = []
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m++) {
    if (m > 11) { m = 0; y++ }
    const me = monthEnd(y, m)
    const planned = scope.filter(d => d.planned && d.planned <= me).length / total * 100
    const actual = me <= today
      ? scope.reduce((s, d) => s + (d.earned && d.earned <= me ? d.prog / 100 : 0), 0) / total * 100
      : null
    scurve.push({ month: me.slice(0, 7), planned: +planned.toFixed(1), actual: actual == null ? null : +actual.toFixed(1) })
    if (me >= end.toISOString().slice(0, 10)) break
  }

  const milestones = Object.entries(milestoneBuckets).map(([name, value]) => ({ name, value }))

  return NextResponse.json({
    scurve, byPackage, variance, milestones,
    scopeDocs: total, generatedAt: new Date().toISOString(),
  })
}
