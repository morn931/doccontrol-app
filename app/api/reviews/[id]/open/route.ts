import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  await db.from('review_tasks').update({
    status: 'in_progress', date_opened: new Date().toISOString(), updated_at: new Date().toISOString()
  }).eq('id', id).in('status', ['sent','opened','pending'])
  return NextResponse.json({ success: true })
}
