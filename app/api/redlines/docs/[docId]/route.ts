import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function ownedDoc(docId: string, email: string) {
  const db = createServiceClient()
  const { data: doc } = await db.from('redline_document')
    .select('id, submission_id, sp_file_url, redline_submission!inner(created_by_email, status)')
    .eq('id', docId).maybeSingle()
  const sub = (doc as any)?.redline_submission
  if (!doc || sub?.created_by_email !== email) return { db, doc: null, sub: null }
  return { db, doc, sub }
}

// Remove a document from the caller's draft basket (the SharePoint copy is
// left behind harmlessly — the folder is per-submission and drafts are cheap).
export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { docId } = await params
  const { db, doc, sub } = await ownedDoc(docId, user.email)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (sub.status !== 'draft') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

  await db.from('redline_document').delete().eq('id', docId)
  return NextResponse.json({ success: true })
}
