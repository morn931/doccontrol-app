import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { getDeveloperSession } from '@/lib/developer-access'

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getDeveloperSession()
  if (!session) return NextResponse.json({ error: 'Developer role required' }, { status: 403 })
  const { userId } = await params
  const body = await req.json()
  const db = createServiceClient()
  const { data, error } = await db.from('users')
    .update({ ...body, updated_at: new Date().toISOString() }).eq('id', userId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logActivity({ area: 'admin', action: 'user.update', targetType: 'user', targetId: userId, summary: body.role ? `role: ${body.role}` : undefined, email: session.user.email })
  return NextResponse.json(data)
}
