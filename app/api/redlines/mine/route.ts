import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// The caller's current DRAFT redline submission (their basket) + its documents.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const { data: submission } = await db.from('redline_submission')
    .select('id, status, submitter_name, created_at')
    .eq('created_by_email', user.email).eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!submission) return NextResponse.json({ submission: null, docs: [] })

  const { data: docs } = await db.from('redline_document')
    .select('id, drawing_number, description, change_description, marked_by, marked_date, file_name, source_kind, created_at')
    .eq('submission_id', submission.id).order('created_at', { ascending: true })
  return NextResponse.json({ submission, docs: docs ?? [] })
}
