import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { REV0_DEFAULT_SIGNATURE } from '@/lib/rev0-default-signature'

// Signature for the Rev 0 stamp (ruled 2026-08-01): the stamp must never go
// out unsigned. The operator's own saved Coreflow signature is used when they
// have one; otherwise the FROZEN default applies — the bundled asset
// public/rev0-default-signature.png (Morné's authorised signature), which only
// changes when that file is deliberately replaced. Scoped to Rev 0 only —
// review sign-offs keep using strictly the reviewer's own signature.
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
  const own = secret ? await fetchSig(user.email, secret) : null
  if (own) return NextResponse.json({ signature: own, source: 'own' })

  return NextResponse.json({ signature: REV0_DEFAULT_SIGNATURE, source: 'frozen-default' })
}
