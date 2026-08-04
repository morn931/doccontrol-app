import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveOpenUrl } from '@/lib/services/sp-resolve'

export const runtime = 'nodejs'

// Resolve a document to its CURRENT SharePoint URL and redirect — survives
// renames / revision changes that make the stored static link 404.
export async function GET(req: NextRequest) {
  const db: any = createServiceClient()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return new NextResponse('Missing id', { status: 400 })

  const { data: row } = await db.from('mddr_entries')
    .select('file_link, linked_version_id, normalized_document_number, document_number')
    .eq('id', id).maybeSingle()
  if (!row) return new NextResponse('Not found', { status: 404 })

  const core = row.normalized_document_number || row.document_number
  const live = await resolveOpenUrl(row.file_link, core)
  if (live) return NextResponse.redirect(live)
  if (row.file_link) return NextResponse.redirect(row.file_link)   // last resort
  // No register link — but the nightly sync may have linked the reviewed
  // version; stream it through the app (fix 2026-08-04).
  if (row.linked_version_id) {
    return NextResponse.redirect(new URL(`/api/documents/${row.linked_version_id}/file`, req.url))
  }
  return new NextResponse('No file link for this document', { status: 404 })
}
