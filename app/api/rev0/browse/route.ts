import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { listLibraryFolder } from '@/lib/services/graph'

const LIBRARY = process.env.REV0_VENDOR_LIBRARY || 'Live Documents'
const DEFAULT_FOLDER = process.env.REV0_VENDOR_FOLDER || 'Rev 0 and up Documents'

// List the vendor site's "Rev 0 and up Documents" folder (or a subfolder like
// the WBS folders) so the controller picks files without downloading anything.
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const url = new URL(req.url)
  const packageId = url.searchParams.get('packageId') ?? ''
  const sub = (url.searchParams.get('path') ?? '').replace(/\.\./g, '')
  if (!packageId) return NextResponse.json({ error: 'packageId required' }, { status: 400 })

  const db = createServiceClient()
  const { data: site } = await db.from('vendor_sites')
    .select('site_url').eq('package_id', packageId).eq('active', true).maybeSingle()
  if (!site?.site_url) return NextResponse.json({ error: 'No vendor site mapped for this package' }, { status: 404 })

  const relPath = sub ? `${DEFAULT_FOLDER}/${sub}` : DEFAULT_FOLDER
  try {
    const items = await listLibraryFolder(site.site_url, LIBRARY, relPath)
    return NextResponse.json({ items, relPath, library: LIBRARY })
  } catch (e: any) {
    return NextResponse.json({ error: `Could not list "${LIBRARY}/${relPath}" on the vendor site: ${e?.message ?? e}` }, { status: 502 })
  }
}
