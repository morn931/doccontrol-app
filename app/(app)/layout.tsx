import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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
  const email = profile?.email ?? user.email ?? ''

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} userName={name} userEmail={email} />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
