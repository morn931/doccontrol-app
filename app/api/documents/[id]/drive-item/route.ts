/**
 * GET /api/documents/[id]/drive-item
 * Returns the SharePoint drive + item ID for a document_version's file, so the browser can
 * mint an EDITABLE Office embed with the signed-in user's delegated token (Graph preview +
 * allowEdit). Resolving here (app token) keeps the file URL off the client.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { resolveDriveItemByUrl } from '@/lib/services/graph'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { data: dv } = await db.from('document_versions').select('central_file_url').eq('id', id).single()
  const url = (dv as any)?.central_file_url
  if (!url) return NextResponse.json({ error: 'No file for this document.' }, { status: 404 })

  try {
    const item = await resolveDriveItemByUrl(url)
    if (!item?.driveId) return NextResponse.json({ error: 'Could not locate the file.' }, { status: 404 })
    return NextResponse.json({ driveId: item.driveId, itemId: item.id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 502 })
  }
}
