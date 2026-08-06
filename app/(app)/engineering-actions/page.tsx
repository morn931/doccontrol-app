import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EngineeringActionsRegister from './engineering-actions-register'

export const dynamic = 'force-dynamic'

// The Engineering Action Register — actions raised from design reviews (and, later, from
// AI-extracted meeting/email actions) land here. The Engineering Manager manages them.
export default async function EngineeringActionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email, full_name, role, eng_action_manager').eq('auth_user_id', user.id).single()
  const { data: rd } = await db.from('role_definitions').select('eng_action_manager').eq('role', (profile as any)?.role ?? '').maybeSingle()
  // Manager surface = the role flag OR a per-person override (migration 039 — lets an assistant
  // help the EM without changing their platform-wide role).
  const isManager = !!(rd as any)?.eng_action_manager || !!(profile as any)?.eng_action_manager

  return (
    <EngineeringActionsRegister
      isManager={isManager}
      me={{ email: (profile as any)?.email ?? user.email ?? '', name: (profile as any)?.full_name ?? null }}
    />
  )
}
