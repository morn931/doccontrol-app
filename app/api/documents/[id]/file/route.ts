import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getFileBytesByUrl } from '@/lib/services/graph'

// Streams a document version's PDF bytes (fetched from SharePoint via Graph) so the
// in-app markup editor can load it without ever exposing the SharePoint URL/library
// to the browser. Auth-gated. SharePoint stays the authoritative store.
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

  try {
    const bytes = await getFileBytesByUrl(fileUrl)
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${(dv.file_name ?? 'document.pdf').replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e: any) {
    console.error('document file stream failed:', e?.message)
    return NextResponse.json({ error: 'Failed to load file from SharePoint' }, { status: 502 })
  }
}
