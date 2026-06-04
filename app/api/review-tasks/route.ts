import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const batchId = searchParams.get('batchId')
  if (!batchId) return NextResponse.json([], { status: 200 })

  const db = createServiceClient()
  const { data } = await db.from('review_tasks')
    .select('id, reviewer_email, sequence_number, status, date_sent, date_completed, review_outcome_code, comment')
    .eq('batch_id', batchId)
    .order('sequence_number', { ascending: true })

  return NextResponse.json(data ?? [])
}
