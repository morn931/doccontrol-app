import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const db = createServiceClient()
  const { data: dv } = await db.from('document_versions')
    .select('central_file_url, returned_file_url, file_name').eq('id', id).single()
  if (!dv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const fileUrl = dv.central_file_url ?? dv.returned_file_url
  if (!fileUrl) return NextResponse.json({ error: 'No file URL available' }, { status: 404 })
  // Phase 1: redirect to SharePoint URL. Phase 2: generate signed Graph API download URL.
  return NextResponse.redirect(fileUrl)
}
