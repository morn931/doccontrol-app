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
    .select('file_link, normalized_document_number, document_number')
    .eq('id', id).maybeSingle()
  if (!row) return new NextResponse('Not found', { status: 404 })

  const core = row.normalized_document_number || row.document_number
  const live = await resolveOpenUrl(row.file_link, core)
  if (live) return NextResponse.redirect(live)
  if (row.file_link) return NextResponse.redirect(row.file_link)   // last resort
  return new NextResponse('No file link for this document', { status: 404 })
}
