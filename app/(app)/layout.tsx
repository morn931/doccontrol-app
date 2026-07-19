import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileNavDrawer } from '@/components/layout/mobile-nav-drawer'
import PageViewLogger from '@/components/page-view-logger'
import type { UserRole } from '@/lib/types/database'
import { getPermissions, can, FK } from '@/lib/permissions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, email')
    .eq('auth_user_id', user.id)
    .single()

  const role = (profile?.role ?? 'reviewer') as UserRole
  const name = profile?.full_name ?? user.email ?? 'User'

  const perms = await getPermissions(supabase)
  const navPerms = {
    batches:      can(perms, FK.NAV_BATCHES,      role),
    reviews:      can(perms, FK.NAV_REVIEWS,      role),
    transmittals: can(perms, FK.NAV_TRANSMITTALS, role),
    mddr:         can(perms, FK.NAV_MDDR,         role),
    reporting:    can(perms, FK.NAV_REPORTING,    role),
    admin:        can(perms, FK.NAV_ADMIN,        role),
    docRequests:  can(perms, FK.NAV_DOC_REQUESTS, role),
  }

  const firstName = name.split(' ')[0]

  return (
    <div className="min-h-screen bg-[var(--page-bg)] flex flex-col">
      <Suspense fallback={null}><PageViewLogger /></Suspense>
      <Header userName={name} role={role} />

      {/* CoreFlow platform-wide hero band — slate backdrop, contained artwork */}
      <div
        className="relative min-h-[168px] overflow-hidden bg-[var(--page-bg)] bg-contain bg-no-repeat max-sm:bg-bottom bg-right"
        style={{ backgroundImage: "url('/coreflow/header/backgrounds/hero-industrial-desktop-1920w_inverted.png')" }}
      >
        <div className="flex flex-col justify-center min-h-[168px] px-6 py-6">
          <p className="text-sm font-bold text-[#012042]">Welcome back, {firstName}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#012042] sm:text-3xl">CoreDocs — Document Control</h1>
        </div>
      </div>

      <div className="relative -mt-12 flex flex-1 gap-4 px-6 pb-6">
        <Sidebar role={role} navPerms={navPerms} />
        <main className="min-w-0 flex-1 py-3">
          {children}
        </main>
        <MobileNavDrawer>
          <Sidebar role={role} navPerms={navPerms} inDrawer />
        </MobileNavDrawer>
      </div>
    </div>
  )
}
