import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Packages with a mapped vendor site, plus each package's DocumentControl
// bucket library — derived from the original flows' footprint (the dominant
// batches.target_library per package), no new mapping to maintain.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const { data: sites } = await db.from('vendor_sites')
    .select('package_id, site_url, active, packages(id, package_code, package_name)')
    .eq('active', true)
  const { data: libs } = await db.from('batches')
    .select('package_id, target_library')
    .not('target_library', 'is', null).limit(2000)

  // dominant target_library per package = the bucket library name
  const counts = new Map<string, Map<string, number>>()
  for (const b of (libs ?? [])) {
    if (!b.package_id) continue
    if (!counts.has(b.package_id)) counts.set(b.package_id, new Map())
    const m = counts.get(b.package_id)!
    const lib = String(b.target_library).replace(/^\//, '').trim()
    m.set(lib, (m.get(lib) ?? 0) + 1)
  }
  const bucketFor = (pid: string) => {
    const m = counts.get(pid)
    if (!m) return null
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }

  const { data: stamped } = await db.from('rev0_intake').select('package_id, file_name').limit(2000)

  const packages = (sites ?? [])
    .filter(s => (s as any).packages)
    .map(s => ({
      packageId: s.package_id,
      code: (s as any).packages.package_code,
      name: (s as any).packages.package_name,
      siteUrl: s.site_url,
      bucketLibrary: bucketFor(s.package_id),
      stampedFiles: (stamped ?? []).filter(x => x.package_id === s.package_id).map(x => x.file_name),
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
  return NextResponse.json({ packages })
}
