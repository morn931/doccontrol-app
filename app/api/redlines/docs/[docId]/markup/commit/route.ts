import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { putFileBytesResumable } from '@/lib/services/graph'

// Flatten the uploader's extra markup into the draft redline's SharePoint file
// (same contract as the review markup commit — the shared component calls it).
export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { docId } = await params
  const db = createServiceClient()
  const { data: doc } = await db.from('redline_document')
    .select('id, sp_file_url, redline_submission!inner(created_by_email, status)')
    .eq('id', docId).maybeSingle()
  const sub = (doc as any)?.redline_submission
  if (!doc?.sp_file_url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (sub?.created_by_email !== user.email) return NextResponse.json({ error: 'Not your submission' }, { status: 403 })
  if (sub?.status !== 'draft') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

  const bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.length) return NextResponse.json({ error: 'Empty body' }, { status: 400 })
  try {
    await putFileBytesResumable(doc.sp_file_url, bytes)
    // The layer is baked into the file now — clear the editable draft layer.
    await db.from('redline_document').update({ markup_layer: null }).eq('id', docId)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: `SharePoint write failed: ${e?.message ?? e}` }, { status: 502 })
  }
}
