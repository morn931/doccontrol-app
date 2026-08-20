import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getNotifications, markNotificationsRead } from '@/lib/notifications'

// The notification bell (in the header, on every page) fetches this. GET returns
// the feed + unread count (materialising from the work sources); POST marks read.
export const dynamic = 'force-dynamic'

async function meEmail(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return ''
  const { data } = await createServiceClient().from('users').select('email').eq('auth_user_id', user.id).single()
  return (data?.email as string) ?? ''
}

export async function GET() {
  const email = await meEmail()
  if (!email) return NextResponse.json({ items: [], unread: 0 })
  return NextResponse.json(await getNotifications(email))
}

export async function POST(req: Request) {
  const email = await meEmail()
  if (!email) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.map(String) : undefined
  const all = body?.all === true
  return NextResponse.json(await markNotificationsRead(email, { ids, all }))
}
