import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { createSessionForSitePath, resolveLibraryName } from '@/lib/services/graph'

const LIBRARY = process.env.REV0_VENDOR_LIBRARY || 'Live Documents'
const DEFAULT_FOLDER = process.env.REV0_VENDOR_FOLDER || 'Rev 0 and up Documents'
const BUCKET_SUBFOLDER = process.env.REV0_BUCKET_FOLDER || 'Rev 0 and up Documents'
const DOCCONTROL_SITE_URL = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!

// Step 1 of stamping: hand the browser two chunked-upload URLs for the
// flattened stamped PDF — (a) REPLACE the vendor's copy in place, (b) file a
// copy in our per-package bucket under "Rev 0 and up Documents/".
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('role').eq('email', user.email).maybeSingle()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_REV0_STAMP, (profile?.role ?? 'reviewer') as any)) {
    return NextResponse.json({ error: 'You do not have permission to stamp Rev 0 documents' }, { status: 403 })
  }

  const { packageId, subPath, fileName, bucketLibrary } = await req.json()
  if (!packageId || !fileName || /[\\]|\.\./.test(String(fileName))) {
    return NextResponse.json({ error: 'packageId and a valid fileName are required' }, { status: 400 })
  }
  const { data: site } = await db.from('vendor_sites')
    .select('site_url').eq('package_id', packageId).eq('active', true).maybeSingle()
  if (!site?.site_url) return NextResponse.json({ error: 'No vendor site mapped for this package' }, { status: 404 })
  if (!bucketLibrary?.trim()) return NextResponse.json({ error: 'No bucket library resolved for this package' }, { status: 422 })

  const vendorRel = `${DEFAULT_FOLDER}${subPath ? `/${String(subPath).replace(/\.\./g, '')}` : ''}/${fileName}`
  try {
    // The derived bucket name is a URL path segment; Graph wants the display
    // name — resolve fuzzily against the site's real libraries.
    const realBucket = await resolveLibraryName(DOCCONTROL_SITE_URL, String(bucketLibrary).trim())
    const vendor = await createSessionForSitePath(site.site_url, LIBRARY, vendorRel)
    const bucket = await createSessionForSitePath(DOCCONTROL_SITE_URL, realBucket, `${BUCKET_SUBFOLDER}/${fileName}`)
    return NextResponse.json({ vendorUploadUrl: vendor.uploadUrl, bucketUploadUrl: bucket.uploadUrl })
  } catch (e: any) {
    return NextResponse.json({ error: `Upload sessions failed: ${e?.message ?? e}` }, { status: 502 })
  }
}
