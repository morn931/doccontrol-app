import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { putFileBytesByUrl, putFileBytesResumable } from '@/lib/services/graph'

// Phase 3 — commit the reviewer's flattened mark-ups back to the authoritative
// SharePoint PDF (via Graph), so the next reviewer opens the document already
// showing them. The editable layer is then cleared (it's baked into the file now);
// the captured text comments are kept for the transmittal.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { data: task } = await db.from('review_tasks').select('id, document_version_id').eq('id', id).single()
  if (!task) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

  const { data: dv } = await db.from('document_versions')
    .select('central_file_url, returned_file_url').eq('id', task.document_version_id).single()
  const fileUrl = dv?.central_file_url ?? dv?.returned_file_url
  if (!fileUrl) return NextResponse.json({ error: 'No file URL to write back to' }, { status: 404 })

  const bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.byteLength) return NextResponse.json({ error: 'Empty document' }, { status: 400 })

  try {
    // Simple upload for typical spec PDFs; resumable session above the ~4 MB limit.
    if (bytes.byteLength < 4 * 1024 * 1024) await putFileBytesByUrl(fileUrl, bytes)
    else await putFileBytesResumable(fileUrl, bytes)
  } catch (e: any) {
    console.error('markup commit to SharePoint failed:', e?.message)
    return NextResponse.json({ error: 'Could not write to SharePoint' }, { status: 502 })
  }

  // Layer is now baked into the SharePoint file → clear it so it isn't double-rendered
  // on reopen; keep the captured comments.
  await db.from('document_markups')
    .update({ layer: {}, updated_at: new Date().toISOString() })
    .eq('document_version_id', task.document_version_id)
    .eq('review_task_id', task.id)

  const { data: profile } = await db.from('users').select('email').eq('auth_user_id', user.id).single()
  await db.from('audit_events').insert({
    entity_type: 'document_version', entity_id: task.document_version_id,
    event_type: 'markup_committed', actor_email: (profile as any)?.email ?? user.email,
    event_data: { review_task_id: task.id, bytes: bytes.byteLength },
  })

  return NextResponse.json({ ok: true })
}
