import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { putFileBytesResumable } from '@/lib/services/graph'
import { prelimAuth, isErr } from '@/lib/prelim'

// "Save to SharePoint": the component flattens the room's layer into the PDF and posts the
// bytes; they replace the working copy in place. The editable layer is then cleared — the
// marks are in the file — and the comments stay, so the checklist survives the flatten.
// Hand-over copies THIS file into the formal batch, which is how the room's marks reach
// the formal reviewers without a second markup mechanism.
export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const { docId } = await params
  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document').select('id, working_file_url, prelim_session!inner(status)').eq('id', docId).maybeSingle()
  if (!doc?.working_file_url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((doc as any).prelim_session?.status !== 'open') return NextResponse.json({ error: 'This session is closed.' }, { status: 409 })
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.length) return NextResponse.json({ error: 'Empty body' }, { status: 400 })
  try {
    await putFileBytesResumable(doc.working_file_url, bytes)
    await db.from('prelim_document').update({ markup_layer: null, markup_committed_at: new Date().toISOString() }).eq('id', docId)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: `SharePoint write failed: ${e?.message ?? e}` }, { status: 502 })
  }
}
