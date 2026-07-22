import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Fetches the signed-in reviewer's sign-off signature from the shell's central store
// (they run on separate Supabase projects, so we go over the secret-gated by-email API)
// plus their display name, for composing the CoreDocs sign-off stamp.
const SHELL_URL = process.env.COREFLOW_SHELL_URL || 'https://coreflow.build'

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await sb.from('users').select('full_name').eq('auth_user_id', user.id).maybeSingle()
  const name = (profile as any)?.full_name || user.email

  const secret = process.env.SIGNATURE_LOOKUP_SECRET
  if (!secret) return NextResponse.json({ signature: null, name, error: 'Signature service not configured' })

  try {
    const res = await fetch(`${SHELL_URL}/api/signature/by-email?email=${encodeURIComponent(user.email)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json({ signature: null, name })
    const data = await res.json()
    return NextResponse.json({ signature: data.signature?.image ?? null, name })
  } catch {
    return NextResponse.json({ signature: null, name })
  }
}
