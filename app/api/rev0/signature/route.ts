import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Signature for the Rev 0 stamp (ruled 2026-08-01): the stamp must never go
// out unsigned. The operator's own saved Coreflow signature is used when they
// have one; otherwise the DEFAULT SIGNATORY's signature applies (system
// setting 'rev0_default_signatory_email', default Morné). Scoped to Rev 0
// only — review sign-offs keep using strictly the reviewer's own signature.
const SHELL_URL = process.env.COREFLOW_SHELL_URL || 'https://coreflow.build'

async function fetchSig(email: string, secret: string): Promise<string | null> {
  try {
    const res = await fetch(`${SHELL_URL}/api/signature/by-email?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()).signature?.image ?? null
  } catch { return null }
}

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const secret = process.env.SIGNATURE_LOOKUP_SECRET
  if (!secret) return NextResponse.json({ signature: null, source: 'none' })

  const own = await fetchSig(user.email, secret)
  if (own) return NextResponse.json({ signature: own, source: 'own' })

  const db = createServiceClient()
  const { data: setting } = await db.from('system_settings')
    .select('value').eq('key', 'rev0_default_signatory_email').maybeSingle()
  const fallbackEmail = ((setting as any)?.value as string | undefined)?.trim() || 'mornec@ppetech.co.za'
  const fallback = await fetchSig(fallbackEmail, secret)
  return NextResponse.json({ signature: fallback, source: fallback ? 'default' : 'none', signatory: fallbackEmail })
}
