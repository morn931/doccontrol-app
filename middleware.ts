import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { readCoreflowPpeEmail } from '@/lib/coreflow-auth'

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

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes that don't need auth
  const publicRoutes = ['/login', '/auth/callback', '/auth/coreflow-bridge']
  if (publicRoutes.some(r => pathname.startsWith(r))) {
    // If already logged in, redirect to the intended destination (deep links from
    // review-notification emails carry ?next=/reviews/<id>) or the dashboard.
    if (user && pathname === '/login') {
      const next = request.nextUrl.searchParams.get('next')
      const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    return supabaseResponse
  }

  // API intake webhook is authenticated by shared secret, not session
  if (pathname.startsWith('/api/intake/webhook')) return supabaseResponse

  // All other routes require authentication.
  if (!user) {
    // Preserve the intended destination through the auth hop, so deep links from
    // notification emails (e.g. "Open Review Workspace" → /reviews/<id>) land on
    // the review itself instead of the dashboard.
    const next = pathname + (request.nextUrl.search || '')
    // Internal PPE staff: if they carry a valid Coreflow session, bridge them in
    // instead of bouncing to CoreDocs' own login. External users (no shared session)
    // fall through to the normal login.
    const ppeEmail = await readCoreflowPpeEmail(request.cookies.getAll())
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
