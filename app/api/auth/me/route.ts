import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Who am I — email + display name for form defaults (e.g. the redline wizard).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const db = createServiceClient()
  const { data: profile } = await db.from('users')
    .select('full_name, role').eq('email', user.email).maybeSingle()
  return NextResponse.json({ email: user.email, full_name: profile?.full_name ?? null, role: profile?.role ?? null })
}
