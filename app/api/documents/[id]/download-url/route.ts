import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { resolveDriveItemByUrl } from '@/lib/services/graph'

/**
 * "Open in SharePoint" fallback — redirects to the file's real SharePoint webUrl (which
 * opens the actual document in Office / the SharePoint viewer). Resolved live via Graph so
 * it works whether the stored URL is a direct file path or a Doc.aspx viewer URL.
 *
 * The previous version rewrote the stored URL into an AllItems.aspx "?id=…&parent=…" link,
 * which mangled Doc.aspx-style URLs (internal-review uploads) into a broken link SharePoint
 * errored on. In-app viewing is now the primary path (PDF markup viewer / read-only Office
 * viewer); this is only the fallback.
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { data: dv } = await db.from('document_versions')
    .select('central_file_url, returned_file_url, file_name').eq('id', id).single()
  if (!dv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const fileUrl = (dv as any).central_file_url ?? (dv as any).returned_file_url
  if (!fileUrl) return NextResponse.json({ error: 'No file URL available' }, { status: 404 })

  // Prefer the canonical webUrl from Graph; fall back to the stored URL as-is.
  let target = fileUrl
  try {
    const item = await resolveDriveItemByUrl(fileUrl)
    if (item?.webUrl) target = item.webUrl
  } catch { /* fall back to the stored URL */ }

  return NextResponse.redirect(target)
}
