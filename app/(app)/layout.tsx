import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import type { UserRole } from '@/lib/types/database'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use the authenticated client — the RLS policy allows authenticated users to read users table
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, email')
    .eq('auth_user_id', user.id)
    .single()

  const role = (profile?.role ?? 'reviewer') as UserRole
  const name = profile?.full_name ?? user.email ?? 'User'

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header userName={name} role={role} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar role={role} />
        <main className="flex-1 overflow-auto px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
