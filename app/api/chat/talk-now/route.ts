import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createOnlineMeeting } from '@/lib/services/graph'

// "Talk now" — mint an instant Teams meet-now meeting (no scheduling) and return its
// join link, so the caller can drop it in the Engineering Room. Optionally pings the
// people they picked via the notification bell. Returns { needsSetup:true } when the
// Graph grant / Teams policy isn't in place yet — the client then falls back to a
// Teams call deep link so "Talk now" still works.
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email, full_name').eq('auth_user_id', user.id).single()
  const email = profile?.email as string
  const name = (profile?.full_name as string) || email
  if (!email) return NextResponse.json({ error: 'No profile.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const invite: string[] = Array.isArray(body?.invite) ? body.invite.map((e: unknown) => String(e).toLowerCase()) : []

  try {
    const { joinUrl } = await createOnlineMeeting(email, 'Engineering Room — quick call')
    // Ping the picked people via the in-screen notification bell.
    const targets = invite.filter((e) => e && e !== email.toLowerCase())
    if (targets.length) {
      const stamp = new Date().toISOString()
      const rows = targets.map((e) => ({
        user_email: e, type: 'message', source_key: `call:${stamp}:${e}`,
        title: `${name} started a call — join`, body: 'Open the Engineering Room to join.', href: '/home',
      }))
      await db.from('notification').upsert(rows, { onConflict: 'user_email,source_key', ignoreDuplicates: true })
    }
    return NextResponse.json({ joinUrl })
  } catch (e) {
    return NextResponse.json({ needsSetup: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
