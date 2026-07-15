import { createClient } from '@/lib/supabase/server'

export async function getDeveloperSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()

  return (profile as { role?: string } | null)?.role === 'developer' ? { user } : null
}
