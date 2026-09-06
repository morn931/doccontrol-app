import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { readCoreflowPpeEmail } from '@/lib/coreflow-auth'

/* WHY THIS FILE HAS TIMEOUTS (after a 504 MIDDLEWARE_INVOCATION_TIMEOUT).
 * This runs on EVERY request. It used to make unbounded network round-trips to
 * Supabase — getUser() to validate the JWT, and (for a logged-out request) a
 * second getUser() against the shared Coreflow project to decide the SSO bridge.
 * When Supabase (behind Cloudflare) stalled, those hung past Vercel's middleware
 * budget and the whole site answered 504. Fix: race every Supabase call against a
 * hard timeout so the middleware always returns fast, and fail CLOSED — a timeout
 * treats the request as unauthenticated (→ /login), never as authenticated. This
 * IS the auth gate, so it must never fail open. A real session comes back on the
 * next request once Supabase recovers, so it is a transient hop, not a logout. */
const AUTH_TIMEOUT_MS = 3500
const TIMED_OUT = Symbol('timeout')

function withTimeout<T>(p: PromiseLike<T>, ms = AUTH_TIMEOUT_MS): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<typeof TIMED_OUT>((r) => setTimeout(() => r(TIMED_OUT), ms)),
  ])
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  // Fail CLOSED: if Supabase does not answer in time, treat the request as
  // unauthenticated (user = null) rather than hanging. A public path still renders;
  // anything gated falls through to the normal no-user redirect below.
  const userRes = await withTimeout(supabase.auth.getUser())
  const user = userRes === TIMED_OUT ? null : userRes.data.user

  const { pathname } = request.nextUrl

  // Public routes that don't need auth
  const publicRoutes = ['/login', '/auth/callback', '/auth/coreflow-bridge']
  if (publicRoutes.some(r => pathname.startsWith(r))) {
    // If already logged in, redirect to the intended destination (deep links from
    // review-notification emails carry ?next=/reviews/<id>) or the dashboard.
    if (user && pathname === '/login') {
      const next = request.nextUrl.searchParams.get('next')
      const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/home'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    return supabaseResponse
  }

  // Secret-gated APIs (authenticated by shared secret, not session — e.g. cross-app feeds)
  if (pathname.startsWith('/api/intake/webhook')) return supabaseResponse
  if (pathname.startsWith('/api/cddl/hours-summary')) return supabaseResponse
  // Vercel Cron routes self-authenticate with CRON_SECRET — skip the session gate.
  if (pathname.startsWith('/api/cron/')) return supabaseResponse
  // Public token-gated share links ("anyone with the link", no login) — the page
  // and its APIs self-authenticate against the share_link token.
  if (pathname.startsWith('/share/')) return supabaseResponse
  if (pathname.startsWith('/api/share/')) return supabaseResponse

  // All other routes require authentication.
  if (!user) {
    // Preserve the intended destination through the auth hop, so deep links from
    // notification emails (e.g. "Open Review Workspace" → /reviews/<id>) land on
    // the review itself instead of the dashboard.
    const next = pathname + (request.nextUrl.search || '')
    // Internal PPE staff: if they carry a valid Coreflow session, bridge them in
    // instead of bouncing to CoreDocs' own login. External users (no shared session)
    // fall through to the normal login.
    // Time-box the shared-project session read too — it is a second Supabase
    // round-trip and would reintroduce the 504 exactly when the primary one is slow.
    const bridgeRes = await withTimeout(readCoreflowPpeEmail(request.cookies.getAll()))
    const ppeEmail = bridgeRes === TIMED_OUT ? null : bridgeRes
    if (ppeEmail) {
      const url = new URL('/auth/coreflow-bridge', request.url)
      url.searchParams.set('next', next)
      return NextResponse.redirect(url)
    }
    const url = new URL('/login', request.url)
    url.searchParams.set('next', next)
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
