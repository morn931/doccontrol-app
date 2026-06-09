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

  return NextResponse.json({ packages, vendors })
}
