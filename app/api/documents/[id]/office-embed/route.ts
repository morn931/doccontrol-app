/**
 * GET /api/documents/[id]/office-embed
 * Returns a short-lived embeddable Office-for-the-web URL for a document_version's file, so
 * the app can render the real Word/Excel INSIDE our own window (iframe) — read-only, no
 * SharePoint sign-in, and closing our window never lands the user in the SharePoint library.
 * Minted per request (the token is short-lived).
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getOfficeEmbedUrl } from '@/lib/services/graph'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { data: dv } = await db.from('document_versions').select('central_file_url, file_name').eq('id', id).single()
  const url = (dv as any)?.central_file_url
  if (!url) return NextResponse.json({ error: 'No file for this document.' }, { status: 404 })

  try {
    const embedUrl = await getOfficeEmbedUrl(url)
    return NextResponse.json({ url: embedUrl, fileName: (dv as any).file_name })
  } catch (e: any) {
    return NextResponse.json({ error: `Could not open the document viewer: ${e?.message ?? e}` }, { status: 502 })
  }
}
