import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Converts a direct SharePoint file URL to the SharePoint viewer URL.
 * The viewer opens the PDF with full annotation/markup tools (draw, text, highlight).
 *
 * Direct URL:  https://site.sharepoint.com/sites/DC/Library/file.pdf
 * Viewer URL:  https://site.sharepoint.com/sites/DC/Library/Forms/AllItems.aspx
 *              ?id=/sites/DC/Library/file.pdf
 *              &parent=/sites/DC/Library
 */
function toSharePointViewerUrl(directUrl: string): string {
  try {
    const url = new URL(directUrl)
    const pathname = decodeURIComponent(url.pathname)

    // Split off the file name from the library path
    const lastSlash = pathname.lastIndexOf('/')
    const libraryPath    = pathname.substring(0, lastSlash)   // /sites/DC/Library
    const serverRelFile  = pathname                            // /sites/DC/Library/file.pdf

    // Build the SharePoint viewer URL
    const viewerBase = `${url.origin}${libraryPath}/Forms/AllItems.aspx`
    const params = new URLSearchParams({
      id:     serverRelFile,
      parent: libraryPath,
    })
    return `${viewerBase}?${params.toString()}`
  } catch {
    // If URL parsing fails for any reason, fall back to direct URL
    return directUrl
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()

  const { data: dv } = await db
    .from('document_versions')
    .select('central_file_url, returned_file_url, file_name')
    .eq('id', id)
    .single()

  if (!dv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const fileUrl = dv.central_file_url ?? dv.returned_file_url
  if (!fileUrl) return NextResponse.json({ error: 'No file URL available' }, { status: 404 })

  // Open in SharePoint viewer with full annotation/markup tools
  const viewerUrl = toSharePointViewerUrl(fileUrl)
  return NextResponse.redirect(viewerUrl)
}
