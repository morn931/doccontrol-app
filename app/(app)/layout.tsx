import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
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
    <div className="min-h-screen bg-[#012042] flex flex-col">
      <Suspense fallback={null}><PageViewLogger /></Suspense>
      <Header userName={name} role={role} />

      <div className="relative min-h-[337px] overflow-hidden bg-[#012042] bg-cover bg-top bg-no-repeat bg-[url('/coreflow/header/backgrounds/hero-industrial-desktop-1920w.png')]">
        <div className="mx-auto flex max-w-400 flex-col justify-center min-h-[337px] px-6 py-8">
          <p className="text-sm text-white/80">Welcome back, <span className="font-semibold text-white">{firstName}</span></p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">CoreDocs — Document Control</h1>
        </div>
      </div>

      <div className="relative -mt-12 flex flex-1 overflow-hidden">
        <Sidebar role={role} navPerms={navPerms} />
        <main className="flex-1 overflow-auto px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
