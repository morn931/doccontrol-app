/**
 * GET /api/company-emails
 *
 * A de-duplicated directory of PPE (@ppetech.co.za) email addresses for the email
 * pickers (recommend-reviewers, Document-Controller recipients). Sourced from the
 * CoreDocs users table, enriched best-effort from the Microsoft Graph tenant
 * directory. Non-PPE addresses are omitted from the dropdown — pickers still allow
 * typing any full email manually.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { graphFetch } from '@/lib/services/graph'
import { NextResponse } from 'next/server'

const DOMAIN = '@ppetech.co.za'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const map = new Map<string, { email: string; name: string }>()

  // 1. CoreDocs users (guaranteed source).
  const db = createServiceClient()
  const { data: users } = await db.from('users').select('email, full_name').eq('active', true)
  for (const u of users ?? []) {
    const email = String(u.email ?? '').trim()
    if (email.toLowerCase().endsWith(DOMAIN)) map.set(email.toLowerCase(), { email, name: u.full_name ?? email })
  }

  // 2. Microsoft Graph tenant directory (best-effort — needs User.Read.All; skipped on failure).
  try {
    const res = await graphFetch(`/users?$select=mail,displayName,userPrincipalName&$top=999`)
    if (res.ok) {
      const j = await res.json()
      for (const p of j.value ?? []) {
        const email = String(p.mail || p.userPrincipalName || '').trim()
        const key = email.toLowerCase()
        if (key.endsWith(DOMAIN) && !map.has(key)) map.set(key, { email, name: p.displayName ?? email })
      }
    }
  } catch { /* directory not available — users table is enough */ }

  const emails = [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ emails })
}
