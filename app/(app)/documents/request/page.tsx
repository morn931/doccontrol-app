import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import RequestForm from './request-form'

export const dynamic = 'force-dynamic'

type Row = { kind: string; code: string; name: string }
type Pkg = { id: string; package_code: string; package_name: string | null }

export default async function NewDocRequestPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = (profile?.role ?? 'reviewer') as string
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_REQUEST_DOC_NUMBER, role)) redirect('/documents/requests')

  const [{ data: lookups }, { data: packages }] = await Promise.all([
    supabase.from('doc_lookup').select('kind, code, name').eq('active', true).order('sort'),
    supabase.from('packages').select('id, package_code, package_name').eq('active', true).order('package_code'),
  ])
  const byKind = (k: string) => ((lookups ?? []) as Row[]).filter((l) => l.kind === k).map((l) => ({ code: l.code, name: l.name }))

  return (
    <RequestForm
      documentTypes={byKind('document_type')}
      disciplines={byKind('discipline')}
      areas={byKind('wbs_area')}
      packages={((packages ?? []) as Pkg[]).map((p) => ({ id: p.id, code: p.package_code, name: p.package_name ?? '' }))}
    />
  )
}
