import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, ListChecks, Upload } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import NewSessionForm from './new-session-form'
import { syncSession } from '@/lib/prelim/sync'
import { prelimStatus, STATUS_LABEL, STATUS_ORDER, type PrelimStatus } from '@/lib/prelim/status'

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
  // Keep every open session in step with its COLAB folder before counting (throttled per
  // session inside syncSession, so a burst of refreshes is one walk).
  const { data: openSessions } = await db.from('prelim_session').select('id, title, status, source_site_url, source_library, source_folder, last_synced_at').eq('status', 'open')
  const { data: { user: me } } = await supabase.auth.getUser()
  await Promise.all(((openSessions ?? []) as any[]).map(sess => syncSession(sess, me?.email ?? 'sync@coredocs').catch(() => null)))
  const { data: sessions } = await db.from('prelim_session')
    .select('id, title, area, held_on, status, attendees, created_by_name, created_by_email, created_at, last_synced_at, last_sync_note, prelim_document(outcome, handed_over_batch_id, routing, returned_at, markup_layer, markup_comments, markup_committed_at)')
    .order('created_at', { ascending: false }).limit(200)

  const rows = (sessions ?? []).map((s: any) => {
    const docs: any[] = s.prelim_document ?? []
    const by: Record<PrelimStatus, number> = { not_started: 0, in_review: 0, sent_drawing_office: 0, sent_document_control: 0, sent_lead: 0, returned: 0, ready_for_tender: 0 }
    for (const d of docs) by[prelimStatus(d)]++
    return { ...s, total: docs.length, by, handed: docs.filter(d => d.handed_over_batch_id).length, prelim_document: undefined }
  })
  const STATUS_TONE: Record<PrelimStatus, string> = { not_started: 'text-slate-400', in_review: 'text-indigo-700', sent_drawing_office: 'text-sky-700', sent_document_control: 'text-indigo-700', sent_lead: 'text-amber-700', returned: 'text-violet-700', ready_for_tender: 'text-emerald-700' }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-5 w-5 text-teal-600" />
          <h1 className="text-xl font-bold text-slate-900">Prelim Review</h1>
        </div>
        <p className="text-sm text-slate-500 max-w-3xl">
          The review before the tender documents go out. Open a review session for the folder the room is looking at, pull the
          drawings in, mark them up together on one shared layer, and on each drawing make one call: <b>To drawing office</b>,
          <b> To Lead</b>, <b>To Document Control</b>, or <b>Ready for tender</b>. A corrected drawing comes back through <b>Return from Drawing Office / Document Control / Lead Engineer</b>
          and is called again. <b>Current Document Status</b> shows every drawing in every session and where it is right now. After tender,
          each drawing still goes through the normal internal review from the same session.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        {canManage && <NewSessionForm />}
        <Link href="/prelim/status" className="btn-secondary"><ListChecks className="h-4 w-4" /> Current Document Status</Link>
        <Link href="/prelim/returns" className="btn-secondary"><Upload className="h-4 w-4" /> Return from Drawing Office / Document Control / Lead Engineer</Link>
      </div>

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
                  {/* The high-level read: how far the session is to tender, then only the states that
                      actually hold drawings — a row of zeros says nothing. */}
                  <div className="mt-0.5">
                    <span className="font-semibold text-emerald-700">{s.by.ready_for_tender} of {s.total} ready for tender</span>
                    {s.total > 0 && <span className="ml-2 inline-block align-middle h-1.5 w-24 rounded bg-slate-100 overflow-hidden"><span className="block h-full bg-emerald-500" style={{ width: `${Math.round((s.by.ready_for_tender / s.total) * 100)}%` }} /></span>}
                  </div>
                  <div className="text-slate-400 flex flex-wrap justify-end gap-x-2">
                    {STATUS_ORDER.filter(k => k !== 'ready_for_tender' && s.by[k] > 0).map((k, i) => <span key={k} className={STATUS_TONE[k]}>{i > 0 ? '· ' : ''}{s.by[k]} {STATUS_LABEL[k].toLowerCase().replace('returned from drawing office / document control / lead', 'returned, awaiting a call')}</span>)}
                    {s.handed > 0 && <span className="text-teal-700">· {s.handed} handed over</span>}
                    {STATUS_ORDER.every(k => k === 'ready_for_tender' || !s.by[k]) && s.handed === 0 && <span className="text-slate-300">nothing else in progress</span>}
                  </div>
                  {s.last_sync_note && <div className="text-[10px] text-slate-300 mt-0.5" title={s.last_sync_note}>folder synced {new Date(s.last_synced_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
