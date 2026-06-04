import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const db = createServiceClient()
  const { data, error } = await db.from('batches')
    .select(`
      id, batch_guid, status, file_count, received_at, started_at, completed_at,
      returned_at, rejected_at, comments, reject_reason, vendor_email,
      vendors(id, name, code),
      packages(id, package_code, package_name),
      document_versions(
        id, file_name, revision, doc_name, discipline, document_type, topic,
        status, is_latest, central_file_url, uploaded_at, ai_text, ai_metadata_source,
        document_id
      )
    `).eq('id', id).single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const db = createServiceClient()
  const { data, error } = await db.from('batches')
    .update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
