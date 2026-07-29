import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Step 2 of adding a redline file: register the uploaded document's metadata
// against the caller's draft submission.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const { submissionId, drawingNumber, description, changeDescription,
          markedBy, markedDate, fileName, spFileUrl, sourceKind } = body
  if (!submissionId || !drawingNumber || !spFileUrl) {
    return NextResponse.json({ error: 'submissionId, drawingNumber and spFileUrl are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: s } = await db.from('redline_submission')
    .select('id, created_by_email, status').eq('id', submissionId).maybeSingle()
  if (!s || s.created_by_email !== user.email) return NextResponse.json({ error: 'Not your submission' }, { status: 403 })
  if (s.status !== 'draft') return NextResponse.json({ error: 'Submission already submitted' }, { status: 409 })

  const { data: doc, error } = await db.from('redline_document').insert({
    submission_id:      submissionId,
    drawing_number:     String(drawingNumber).trim(),
    description:        description || null,
    change_description: changeDescription || null,
    marked_by:          markedBy || user.email,
    marked_date:        markedDate || new Date().toISOString().slice(0, 10),
    file_name:          fileName || null,
    sp_file_url:        spFileUrl,
    source_kind:        sourceKind === 'photo' ? 'photo' : 'scan',
  }).select('id').single()
  if (error || !doc) return NextResponse.json({ error: error?.message ?? 'Could not save' }, { status: 500 })
  return NextResponse.json({ id: doc.id })
}
