import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EngineeringActionsRegister from './engineering-actions-register'
import { isEngActionManager } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// The Engineering Action Register — actions raised from design reviews (and, later, from
// AI-extracted meeting/email actions) land here. The Engineering Manager manages them.
export default async function EngineeringActionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email, full_name, role').eq('auth_user_id', user.id).single()
  const isManager = (await isEngActionManager(db, user.id)).ok

  return (
    <EngineeringActionsRegister
      isManager={isManager}
      me={{ email: (profile as any)?.email ?? user.email ?? '', name: (profile as any)?.full_name ?? null }}
    />
  )
}
