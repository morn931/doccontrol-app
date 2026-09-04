import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getFileBytesByUrl, getDriveItemMetaByUrl } from '@/lib/services/graph'
import { contentDisposition } from '@/lib/http/content-disposition'
import { prelimAuth, isErr } from '@/lib/prelim'

// Stream the working PDF for the in-app markup. Same big-file escape hatch as the review
// file route: over ~4 MB the browser is redirected to Graph's short-lived download URL,
// because a Vercel function response cannot carry a 13 MB drawing.
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const { docId } = await params
  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document').select('working_file_url, working_file_name').eq('id', docId).maybeSingle()
  if (!doc?.working_file_url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const meta = await getDriveItemMetaByUrl(doc.working_file_url)
    if (meta?.downloadUrl && (meta.size ?? 0) > 4_000_000) return NextResponse.redirect(meta.downloadUrl, 307)
    const bytes = await getFileBytesByUrl(doc.working_file_url)
    return new NextResponse(bytes, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition('inline', doc.working_file_name ?? 'document.pdf'), 'Cache-Control': 'private, no-store' },
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Could not fetch file: ${e?.message ?? e}` }, { status: 502 })
  }
}
