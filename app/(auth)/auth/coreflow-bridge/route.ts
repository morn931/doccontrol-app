import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { readCoreflowPpeEmail } from '@/lib/coreflow-auth'

// ── Coreflow SSO bridge (mint side) ──────────────────────────────────────────
// A PPE user arrives with a valid SHARED Coreflow session but no CoreDocs session.
// We silently establish a CoreDocs (own-project) session for them, so the rest of
// the app works unchanged. External users never reach here (no shared session).
// Access policy: OPEN to all @ppetech.co.za staff — any PPE Coreflow user who has
// no `users` row yet is auto-provisioned at the lowest role ('reviewer'); an admin
// can raise their role afterwards in Admin → Users.
export async function GET(request: NextRequest) {
  const HUB = 'https://coreflow.build/login'
  const cookieStore = await cookies()

  const email = await readCoreflowPpeEmail(cookieStore.getAll())
  if (!email) return NextResponse.redirect(HUB)

  const ownUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const ownAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const admin = createAdmin(ownUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Look up the CoreDocs user; auto-provision (role defaults to 'reviewer') if new.
  let { data: profile } = await admin
    .from('users').select('id, auth_user_id').eq('email', email).maybeSingle()
  if (!profile) {
    // Derive a human-ish display name from the email local part
    // ("abigail.venter" -> "Abigail Venter", "AbigailV" -> "Abigail V").
    const fullName =
      email.split('@')[0]
        .replace(/[._-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || email
    // Upsert is race-safe (email is UNIQUE); then re-read the row.
    await admin.from('users')
      .upsert({ email, full_name: fullName }, { onConflict: 'email', ignoreDuplicates: true })
    const { data: ensured } = await admin
      .from('users').select('id, auth_user_id').eq('email', email).single()
    if (!ensured) return NextResponse.redirect(new URL('/login?coreflow=err', request.url))
    profile = ensured
  }

  // Ensure an own-project auth user exists for this email (idempotent).
  if (!profile.auth_user_id) {
    const { data: created } = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (created?.user?.id) {
      await admin.from('users').update({ auth_user_id: created.user.id }).eq('id', profile.id)
    }
  }

  // Mint a one-time magic-link token (admin, not emailed) and consume it to set the
  // CoreDocs own-project session cookie on the response.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) return NextResponse.redirect(new URL('/login?coreflow=err', request.url))
  if (!profile.auth_user_id && link?.user?.id) {
    await admin.from('users').update({ auth_user_id: link.user.id }).eq('id', profile.id)
  }

  const res = NextResponse.redirect(new URL('/dashboard', request.url))
  const supa = createServerClient(ownUrl, ownAnon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  })
  const { error: vErr } = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (vErr) return NextResponse.redirect(new URL('/login?coreflow=verify', request.url))
  return res
}
