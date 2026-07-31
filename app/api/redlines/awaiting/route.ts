import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Redlines waiting on the caller's As-Built (accepted by them, drafting in
// progress) — feeds the dashboard card and the /redlines/awaiting list.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const { data: subs } = await db.from('redline_submission')
    .select('id, submitter_name, created_by_email, accepted_at, submitted_at')
    .eq('review_state', 'awaiting_asbuilt')
    .eq('asbuilt_engineer_email', user.email)
    .order('accepted_at', { ascending: true })
  if (!subs?.length) return NextResponse.json({ items: [] })

  const { data: docs } = await db.from('redline_document')
    .select('submission_id, drawing_number, description, change_description')
    .in('submission_id', subs.map(s => s.id))
  const items = subs.map(s => ({
    ...s,
    docs: (docs ?? []).filter(d => d.submission_id === s.id),
  }))
  return NextResponse.json({ items })
}
