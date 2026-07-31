import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getFileBytesByUrl } from '@/lib/services/graph'

// Stream a vendor Rev 0 file for the stamping viewer. Restricted to our
// SharePoint tenant so this can't be used to fetch arbitrary URLs.
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const fileUrl = new URL(req.url).searchParams.get('url') ?? ''
  let host = ''
  try { host = new URL(fileUrl).hostname } catch { /* ignore */ }
  if (host !== 'ppetechcoza.sharepoint.com') {
    return NextResponse.json({ error: 'Only PPE SharePoint documents can be streamed' }, { status: 400 })
  }
  try {
    const bytes = await getFileBytesByUrl(fileUrl)
    return new NextResponse(bytes, {
      headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Could not fetch: ${e?.message ?? e}` }, { status: 502 })
  }
}
