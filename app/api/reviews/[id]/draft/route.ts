import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const { comment, outcomeCode } = await req.json()
  const db = createServiceClient()
  await db.from('review_tasks').update({
    comment: comment ?? null,
    review_outcome_code: outcomeCode ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).not('status', 'eq', 'completed')
  return NextResponse.json({ success: true })
}
