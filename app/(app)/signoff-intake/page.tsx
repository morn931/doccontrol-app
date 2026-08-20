import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getPermissions, can, FK } from '@/lib/permissions'
import SignoffIntake from './intake'

export const dynamic = 'force-dynamic'

// Document-Controller Sign-off Intake — pick a CDDL document, upload the Aconex-returned file, send
// it straight to sign-off (review skipped). Gated by ACTION_APPROVE_SIGNOFF_ONLY.
export default async function SignoffIntakePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_APPROVE_SIGNOFF_ONLY, (profile?.role ?? 'reviewer') as any)) redirect('/home')

  return <SignoffIntake />
}
