import { createServerClient } from '@supabase/ssr'

// ── Coreflow SSO bridge (read side) ──────────────────────────────────────────
// CoreDocs runs on its OWN Supabase project. The Coreflow platform session lives in
// a cookie scoped to `.coreflow.build`, signed by the SHARED project. This reads that
// shared session and returns the signed-in email — but ONLY for internal @ppetech.co.za
// users. External users have no shared session and keep CoreDocs' own login untouched.

const PPE_DOMAIN = 'ppetech.co.za'

type SimpleCookie = { name: string; value: string }

// Works from both middleware (request.cookies.getAll()) and route handlers
// ((await cookies()).getAll()) — caller passes the cookie list.
export async function readCoreflowPpeEmail(allCookies: SimpleCookie[]): Promise<string | null> {
  const url = process.env.COREFLOW_SUPABASE_URL
  const anon = process.env.COREFLOW_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  try {
    const supa = createServerClient(url, anon, {
      cookies: { getAll: () => allCookies, setAll: () => {} },
    })
    const { data: { user } } = await supa.auth.getUser()
    const email = user?.email?.toLowerCase() ?? null
    return email && email.endsWith('@' + PPE_DOMAIN) ? email : null
  } catch {
    return null
  }
}
