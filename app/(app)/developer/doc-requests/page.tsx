import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getControllerEmail } from '../../documents/requests/actions'
import SettingsForm from './settings-form'

export const dynamic = 'force-dynamic'

export default async function DocRequestSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = (profile?.role ?? 'reviewer') as string
  if (role !== 'developer' && role !== 'admin') redirect('/dashboard')

  const email = await getControllerEmail()

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-bold text-slate-900">Document Requests — settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        When an engineer submits a document number request, an email is sent to the address below (the
        Document Controller&apos;s inbox) with a link to allocate the RDMC numbers.
      </p>

      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
        <SettingsForm current={email} />
      </div>

      <p className="mt-4 text-xs text-slate-400">
        The requestor is emailed automatically once every line on their request has been allocated.
        · <Link href="/documents/requests" className="text-teal-700 hover:underline">Open the requests queue →</Link>
      </p>
    </div>
  )
}
