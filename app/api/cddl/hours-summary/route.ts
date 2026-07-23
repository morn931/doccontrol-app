/**
 * GET /api/cddl/hours-summary?secret=...
 *
 * Cross-app feed for CoreCost's live Engineering Earned-Value view. Returns the
 * K124 CDDL planned + earned hours grouped by engineering discipline, computed
 * live from cddl_doc + the hour estimator (same numbers the CDDL page shows).
 * Secret-gated so CoreCost can fetch it server-to-server.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { estimateHours } from '@/lib/cddl/hour-estimator'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GROUP = (d?: string | null): string =>
  (({ E: 'Electrical', C: 'Civil/Concrete', I: 'Instrumentation', M: 'Mechanical' } as Record<string, string>)[(d ?? '').trim()] ?? 'Other')

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get('secret')
  const expected = process.env.CDDL_SUMMARY_SECRET
  if (!expected || secret !== expected) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const rows: Array<{ discipline: string | null; doc_type: string | null; pct_complete: number | null; retired: boolean | null }> = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await db.from('cddl_doc')
      .select('discipline,doc_type,pct_complete,retired')
      .eq('package_code', 'K124').order('docno', { ascending: true }).range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data ?? []) as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!data || data.length < 1000) break
  }

  const byDiscipline: Record<string, { planned: number; earned: number; docs: number }> = {}
  let planned = 0, earned = 0, docs = 0
  for (const r of rows) {
    if (r.retired) continue
    const p = estimateHours(r.discipline, r.doc_type)
    const e = p * (Number(r.pct_complete) || 0)
    const g = GROUP(r.discipline)
    if (!byDiscipline[g]) byDiscipline[g] = { planned: 0, earned: 0, docs: 0 }
    byDiscipline[g].planned += p; byDiscipline[g].earned += e; byDiscipline[g].docs += 1
    planned += p; earned += e; docs += 1
  }
  return NextResponse.json({ byDiscipline, totals: { planned, earned, docs }, generatedAt: new Date().toISOString() })
}
