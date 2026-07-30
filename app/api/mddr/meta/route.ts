import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Returns distinct packages and vendors (optionally filtered by package)
export async function GET(req: NextRequest) {
  const db  = createServiceClient()
  const url = new URL(req.url)
  const pkg = url.searchParams.get('package') ?? ''
  const awarded = url.searchParams.get('awarded') ?? 'true'
  const excludeIndex = url.searchParams.get('exclude_index') === '1'

  // Preferred: server-side DISTINCT (migration 026) — cap-proof, so rare values
  // (a new Sector / vendor with only a handful of rows) still appear as chips.
  const rpc = await db.rpc('mddr_filter_options', { p_awarded: awarded, p_package: pkg || null, p_exclude_index: excludeIndex })
  if (!rpc.error && rpc.data) {
    const d: any = rpc.data
    return NextResponse.json({
      packages: d.packages ?? [], vendors: d.vendors ?? [], disciplines: d.disciplines ?? [],
      documentTypes: d.documentTypes ?? [], statuses: d.statuses ?? [], sectors: d.sectors ?? [], revisions: d.revisions ?? [],
    })
  }

  // Fallback (until migration 026 is applied): JS distinct over a capped sample.
  // Generic distinct-value helper with the shared filters.
  async function distinct(col: string, withPackage = true): Promise<string[]> {
    let qy = db.from('mddr_entries').select(col).eq('is_active', true).not(col, 'is', null)
    if (awarded === 'true')  qy = qy.eq('is_awarded', true)
    if (awarded === 'false') qy = qy.eq('is_awarded', false)
    if (excludeIndex)        qy = qy.neq('source_type', 'INDEX')
    if (pkg && withPackage)  qy = qy.eq('package_code', pkg)
    // Scan the whole table (not a 20k sample) so low-frequency values — e.g. a new
    // Sector like "Contractual" with only ~20 rows — still surface as filter chips.
    const { data } = await qy.limit(200000)
    return [...new Set((data ?? []).map((r: any) => r[col]).filter(Boolean))].sort()
  }

  const [packages, vendors, disciplines, documentTypes, statuses, sectors, revisions] = await Promise.all([
    distinct('package_code', false), distinct('vendor_name'),
    distinct('discipline'), distinct('document_type'), distinct('document_status'),
    distinct('sector', false), distinct('revision'),
  ])

  return NextResponse.json({ packages, vendors, disciplines, documentTypes, statuses, sectors, revisions })
}
