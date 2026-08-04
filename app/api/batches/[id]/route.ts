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
      id, batch_guid, status, source, request_line_id, internal_ref,
      file_count, received_at, started_at, completed_at,
      returned_at, rejected_at, comments, reject_reason, vendor_email,
      reject_bucket_deleted, reject_source_deleted, reject_picks_closed,
      reject_vendor_notified, reject_cleanup_error, sp_approver_picks_id,
      recommended_reviewers,
      vendors(id, name, code, primary_contact_email),
      packages(id, package_code, package_name),
      document_versions(
        id, file_name, revision, doc_name, discipline, document_type, topic,
        status, is_latest, central_file_url, uploaded_at, ai_text, ai_metadata_source,
        document_id, is_rejected, reject_reason, reject_bucket_deleted, reject_source_deleted
      )
    `).eq('id', id).single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })

  // For internal batches, resolve the engineer (requestor) email from the linked
  // Document Request — the "return" goes to them, not a vendor. Simple two-step
  // lookups (no PostgREST embeds) to stay resilient to schema-cache timing.
  let engineerEmail: string | null = null
  if ((data as any).source === 'internal' && (data as any).request_line_id) {
    const { data: line } = await db.from('document_number_request_line')
      .select('request_id').eq('id', (data as any).request_line_id).single()
    if (line?.request_id) {
      const { data: reqHdr } = await db.from('document_number_request')
        .select('requestor_email').eq('id', line.request_id).single()
      engineerEmail = reqHdr?.requestor_email ?? null
    }
  }
  return NextResponse.json({ ...data, engineer_email: engineerEmail })
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
