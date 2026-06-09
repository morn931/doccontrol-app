import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 120

const PERIOD_START = '2025-05-01'
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)

export async function GET(req: NextRequest) {
  const db: any = createServiceClient()
  const url = new URL(req.url)
  const pkg     = url.searchParams.get('package') || ''
  const vendor  = url.searchParams.get('vendor')  || ''
  const source  = url.searchParams.get('source')  || ''
  const awarded = url.searchParams.get('awarded') || 'true'   // true | false | all
  const today = new Date().toISOString().slice(0, 10)

  type Pkg = { active: number; planned: number; prog: number }
  const pkgAcc: Record<string, Pkg> = {}
  const milestoneBuckets = { 'Not started': 0, 'Submitted (25%)': 0, 'Reviewed (75%)': 0, 'Accepted (85%)': 0, 'Final IFC/IFD (100%)': 0 }
  type Doc = { planned: string | null; earned: string | null; prog: number }
  const scope: Doc[] = []
  let minDate = PERIOD_START
  let totalDocs = 0

  for (let from = 0; ; from += 1000) {
    let q = db.from('mddr_entries')
      .select('package_code, progress_percent, planned_completion_date, actual_submission_date, actual_completion_date')
      .eq('is_active', true)
      .order('id', { ascending: true }).range(from, from + 999)
    if (awarded === 'true')  q = q.eq('is_awarded', true)
    if (awarded === 'false') q = q.eq('is_awarded', false)
    if (pkg)    q = q.eq('package_code', pkg)
    if (vendor) q = q.eq('vendor_name', vendor)
    if (source) q = q.eq('source_type', source)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const r of data ?? []) {
      const p = Number(r.progress_percent ?? 0)
      totalDocs++
      if (p <= 0) milestoneBuckets['Not started']++
      else if (p < 50) milestoneBuckets['Submitted (25%)']++
      else if (p < 82) milestoneBuckets['Reviewed (75%)']++
      else if (p < 100) milestoneBuckets['Accepted (85%)']++
      else milestoneBuckets['Final IFC/IFD (100%)']++

      const code = r.package_code || '—'
      const a = (pkgAcc[code] ??= { active: 0, planned: 0, prog: 0 })
      a.active++; a.prog += p
      if (r.planned_completion_date && r.planned_completion_date <= today) a.planned++

      if (r.planned_completion_date) {
        const earned = r.actual_completion_date || r.actual_submission_date || (p > 0 ? today : null)
        scope.push({ planned: r.planned_completion_date, earned, prog: p })
        if (r.planned_completion_date < minDate) minDate = r.planned_completion_date
      }
    }
    if (!data || data.length < 1000) break
  }

  const byPackage = Object.entries(pkgAcc)
    .map(([p, a]) => ({
      package: p,
      planned: +(a.active ? a.planned / a.active * 100 : 0).toFixed(1),
      actual:  +(a.active ? a.prog / a.active : 0).toFixed(1),
    }))
    .sort((a, b) => a.package.localeCompare(b.package))
  const variance = byPackage
    .map(p => ({ package: p.package, variance: +(p.actual - p.planned).toFixed(1) }))
    .sort((a, b) => a.variance - b.variance)

  // S-curve over scheduled scope.
  const total = scope.length || 1
  const maxPlanned = scope.reduce((m, d) => (d.planned && d.planned > m ? d.planned : m), today)
  const start = new Date(minDate + 'T00:00:00Z')
  const endTs = Math.max(Math.min(Date.parse(maxPlanned), Date.parse(today) + 730 * 864e5), Date.parse(today))
  const endStr = new Date(endTs).toISOString().slice(0, 10)

  const scurve: { month: string; planned: number; actual: number | null }[] = []
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m++) {
    if (m > 11) { m = 0; y++ }
    const me = monthEnd(y, m)
    const planned = scope.filter(d => d.planned && d.planned <= me).length / total * 100
    const actual = me <= today
      ? scope.reduce((s, d) => s + (d.earned && d.earned <= me ? d.prog / 100 : 0), 0) / total * 100
      : null
    scurve.push({ month: me.slice(0, 7), planned: +planned.toFixed(1), actual: actual == null ? null : +actual.toFixed(1) })
    if (me >= endStr) break
  }

  const plannedNow = +(scope.filter(d => d.planned && d.planned <= today).length / total * 100).toFixed(1)
  const actualNow  = +(scope.reduce((s, d) => s + (d.earned && d.earned <= today ? d.prog / 100 : 0), 0) / total * 100).toFixed(1)
  const milestones = Object.entries(milestoneBuckets).map(([name, value]) => ({ name, value }))

  return NextResponse.json({
    scurve, byPackage, variance, milestones,
    totalDocs, scopeDocs: scope.length, plannedNow, actualNow,
    todayMonth: today.slice(0, 7),
    filters: { package: pkg || 'ALL', vendor: vendor || 'ALL', source: source || 'ALL', awarded },
    generatedAt: new Date().toISOString(),
  })
}
