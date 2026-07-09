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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Suspense fallback={null}><PageViewLogger /></Suspense>
      <Header userName={name} role={role} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar role={role} navPerms={navPerms} />
        <main className="flex-1 overflow-auto px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
