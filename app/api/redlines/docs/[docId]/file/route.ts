import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getFileBytesByUrl } from '@/lib/services/graph'
import { contentDisposition } from '@/lib/http/content-disposition'

// Stream a draft redline PDF from SharePoint for the in-app viewer/markup.
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { docId } = await params
  const db = createServiceClient()
  const { data: doc } = await db.from('redline_document')
    .select('id, file_name, sp_file_url').eq('id', docId).maybeSingle()
  if (!doc?.sp_file_url) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const bytes = await getFileBytesByUrl(doc.sp_file_url)
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition('inline', doc.file_name ?? 'redline.pdf'),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Could not fetch file: ${e?.message ?? e}` }, { status: 502 })
  }
}
