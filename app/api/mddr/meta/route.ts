import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Returns distinct packages and vendors (optionally filtered by package)
export async function GET(req: NextRequest) {
  const db  = createServiceClient()
  const url = new URL(req.url)
  const pkg = url.searchParams.get('package') ?? ''
  const awarded = url.searchParams.get('awarded') ?? 'true'

  // Packages
  let pkgQ = db
    .from('mddr_entries')
    .select('package_code')
    .eq('is_active', true)
    .not('package_code', 'is', null)
    .order('package_code')
  if (awarded === 'true')  pkgQ = pkgQ.eq('is_awarded', true)
  if (awarded === 'false') pkgQ = pkgQ.eq('is_awarded', false)
  const { data: pkgData } = await pkgQ

  const packages = [...new Set((pkgData ?? []).map((r: any) => r.package_code).filter(Boolean))].sort()

  // Vendors (filtered by package if provided)
  let venQ = db
    .from('mddr_entries')
    .select('vendor_name')
    .eq('is_active', true)
    .not('vendor_name', 'is', null)

  if (awarded === 'true')  venQ = venQ.eq('is_awarded', true)
  if (awarded === 'false') venQ = venQ.eq('is_awarded', false)
  if (pkg) venQ = venQ.eq('package_code', pkg)

  const { data: venData } = await venQ.order('vendor_name')

  const vendors = [...new Set((venData ?? []).map((r: any) => r.vendor_name).filter(Boolean))].sort()

  // Distinct disciplines / document types / statuses (awarded-scoped, optional package)
  async function distinct(col: string): Promise<string[]> {
    let qy = db.from('mddr_entries').select(col).eq('is_active', true).not(col, 'is', null)
    if (awarded === 'true')  qy = qy.eq('is_awarded', true)
    if (awarded === 'false') qy = qy.eq('is_awarded', false)
    if (pkg) qy = qy.eq('package_code', pkg)
    const { data } = await qy.limit(20000)
    return [...new Set((data ?? []).map((r: any) => r[col]).filter(Boolean))].sort()
  }
  const [disciplines, documentTypes, statuses] = await Promise.all([
    distinct('discipline'), distinct('document_type'), distinct('document_status'),
  ])

  return NextResponse.json({ packages, vendors, disciplines, documentTypes, statuses })
}
