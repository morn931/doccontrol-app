import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DeveloperPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  if (!me || me.role !== 'developer') redirect('/dashboard')

  const card = 'group relative flex flex-col gap-4 rounded-xl bg-white border border-slate-200 p-7 hover:border-teal-300 hover:shadow-md transition-all'
  const dimCard = 'group relative flex flex-col gap-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 p-7'

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Developer Tools</h1>
        <p className="text-sm text-slate-500 mt-1">Configuration utilities and reference tools for CoreDocs.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Users & Role Assignment */}
        <Link href="/admin/users" className={card}>
          <div className="w-14 h-14 rounded-xl border-2 border-teal-100 group-hover:border-teal-300 flex items-center justify-center transition-colors flex-shrink-0">
            <svg className="w-7 h-7 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.205-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800 group-hover:text-teal-700 transition-colors">Users &amp; Role Assignment</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Add CoreDocs users and assign the role that determines their effective access.</p>
          </div>
        </Link>


        {/* Role Permissions */}
        <Link href="/developer/permissions" className={card}>
          <div className="w-14 h-14 rounded-xl border-2 border-teal-100 group-hover:border-teal-300 flex items-center justify-center transition-colors flex-shrink-0">
            <svg className="w-7 h-7 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800 group-hover:text-teal-700 transition-colors">Role Access Matrix</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Configure which pages and actions are available to each CoreDocs role.</p>
          </div>
        </Link>

        {/* Coming soon placeholders */}
        <div className={dimCard}>
          <div className="w-14 h-14 rounded-xl border-2 border-slate-200 flex items-center justify-center flex-shrink-0">
            <svg className="w-7 h-7 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-400">Re-trigger SharePoint Sync</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">Manually kick off a full intake scan for all vendor drop-off libraries. Coming soon.</p>
          </div>
        </div>

        <div className={dimCard}>
          <div className="w-14 h-14 rounded-xl border-2 border-slate-200 flex items-center justify-center flex-shrink-0">
            <svg className="w-7 h-7 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-400">DB Health Check</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">Row counts, orphaned records, and data integrity checks across key tables. Coming soon.</p>
          </div>
        </div>

      </div>
    </div>
  )
}
