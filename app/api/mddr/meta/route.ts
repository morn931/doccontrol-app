import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Returns distinct packages and vendors (optionally filtered by package)
export async function GET(req: NextRequest) {
  const db  = createServiceClient()
  const url = new URL(req.url)
  const pkg = url.searchParams.get('package') ?? ''
  const awarded = url.searchParams.get('awarded') ?? 'true'
  const excludeIndex = url.searchParams.get('exclude_index') === '1'

  // Generic distinct-value helper with the shared filters.
  async function distinct(col: string, withPackage = true): Promise<string[]> {
    let qy = db.from('mddr_entries').select(col).eq('is_active', true).not(col, 'is', null)
    if (awarded === 'true')  qy = qy.eq('is_awarded', true)
    if (awarded === 'false') qy = qy.eq('is_awarded', false)
    if (excludeIndex)        qy = qy.neq('source_type', 'INDEX')
    if (pkg && withPackage)  qy = qy.eq('package_code', pkg)
    const { data } = await qy.limit(20000)
    return [...new Set((data ?? []).map((r: any) => r[col]).filter(Boolean))].sort()
  }

  const [packages, vendors, disciplines, documentTypes, statuses, sectors, revisions] = await Promise.all([
    distinct('package_code', false), distinct('vendor_name'),
    distinct('discipline'), distinct('document_type'), distinct('document_status'),
    distinct('sector', false), distinct('revision'),
  ])

  return NextResponse.json({ packages, vendors, disciplines, documentTypes, statuses, sectors, revisions })
}
