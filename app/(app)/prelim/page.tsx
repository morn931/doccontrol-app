import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import NewSessionForm from './new-session-form'

export const dynamic = 'force-dynamic'

// Prelim Review — the group pass in the boardroom, in front of the formal internal review.
// A session pulls drawings from a source folder, the room marks them up together and
// records an outcome per drawing, and "hand over" puts each ready drawing into the formal
// chain through the same front doors an engineer uses. See migration 051.
export default async function PrelimSessionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = String(profile?.role ?? 'reviewer')
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.NAV_PRELIM_REVIEW, role)) redirect('/dashboard')
  const canManage = can(perms, FK.ACTION_PRELIM_MANAGE, role)

  const db = createServiceClient()
  const { data: sessions } = await db.from('prelim_session')
    .select('id, title, area, held_on, status, attendees, created_by_name, created_by_email, created_at, prelim_document(outcome, handed_over_batch_id)')
    .order('created_at', { ascending: false }).limit(200)

  const rows = (sessions ?? []).map((s: any) => {
    const docs: any[] = s.prelim_document ?? []
    const n = (o: string) => docs.filter(d => d.outcome === o).length
    return { ...s, total: docs.length, pending: n('pending'), ready: n('ready'), rework: n('rework'), withdrawn: n('withdrawn'), handed: docs.filter(d => d.handed_over_batch_id).length }
  })

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-5 w-5 text-teal-600" />
          <h1 className="text-xl font-bold text-slate-900">Prelim Review</h1>
        </div>
        <p className="text-sm text-slate-500 max-w-3xl">
          The group pass before a document enters internal review. Open a session for the folder the room is looking at,
          pull the drawings in, mark them up together on one shared layer, and record the room&rsquo;s call on each.
          A drawing marked <b>ready</b> is handed over into the normal internal review with the room&rsquo;s marks in the
          file and its comments as the first handover note. Nothing here is part of the formal record until it is handed over.
        </p>
      </div>

      {canManage && <NewSessionForm />}

      <div className="card overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200 flex items-baseline justify-between">
          <h2 className="font-semibold text-slate-900">Sessions</h2>
          <span className="text-xs text-slate-500">{rows.length} session{rows.length === 1 ? '' : 's'}</span>
        </div>
        {!rows.length && <p className="px-6 py-8 text-sm text-slate-400">No sessions yet{canManage ? ' — open one above.' : '.'}</p>}
        <ul className="divide-y divide-slate-100">
          {rows.map((s: any) => (
            <li key={s.id}>
              <Link href={`/prelim/${s.id}`} className="flex items-start gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900 truncate">{s.title}</p>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${s.status === 'open' ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600'}`}>{s.status}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {[s.area, s.held_on ? new Date(s.held_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null, s.created_by_name ?? s.created_by_email].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-600 tabular-nums">
                  <div><b className="text-slate-900">{s.total}</b> drawings</div>
                  <div className="text-slate-400">{s.pending} pending · {s.ready} ready · {s.rework} rework · {s.withdrawn} withdrawn · {s.handed} handed over</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
