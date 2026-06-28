'use server'

import { createClient } from '@/lib/supabase/server'

export async function updatePermission(featureKey: string, role: string, allowed: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: me } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  if (!me || me.role !== 'developer') throw new Error('Developer role required')

  await supabase
    .from('role_permissions')
    .upsert(
      { feature_key: featureKey, role, allowed, updated_at: new Date().toISOString() },
      { onConflict: 'feature_key,role' },
    )
}
