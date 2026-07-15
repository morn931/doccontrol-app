import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { getDeveloperSession } from '@/lib/developer-access'

export async function GET(_req: Request) {
  const session = await getDeveloperSession()
  if (!session) return NextResponse.json({ error: 'Developer role required' }, { status: 403 })
  const db = createServiceClient()
  const { data } = await db.from('users').select('*').order('full_name')
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const session = await getDeveloperSession()
  if (!session) return NextResponse.json({ error: 'Developer role required' }, { status: 403 })
  const body = await req.json()
  const db = createServiceClient()
  const { data, error } = await db.from('users').insert({
    email: body.email, full_name: body.full_name, role: body.role ?? 'reviewer',
    department: body.department ?? null, discipline: body.discipline ?? null, active: true,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logActivity({ area: 'admin', action: 'user.create', targetType: 'user', targetId: data?.id, summary: `${body.email} · ${body.role ?? 'reviewer'}`, email: session.user.email })
  return NextResponse.json(data, { status: 201 })
}
