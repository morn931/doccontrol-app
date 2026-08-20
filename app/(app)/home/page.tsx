import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCockpitData, type CockpitBatch } from '@/lib/cockpit'
import { getTimeAndLeave, type TimeAndLeave } from '@/lib/coretime'
import { getRoutedToMe, getRoutedByMeCount } from '@/lib/routing'
import { getUpcomingMeetings, type MeetingItem } from '@/lib/meetings'
import { isChatAdmin } from '@/lib/chat-perms'
import type { CockpitAction } from '@/lib/cockpit'
import RoutedRow from './routed-row'
import RouteButton, { type Reviewer } from './route-button'
import ChatDock from './chat-dock'
import Link from 'next/link'
import { format, formatDistanceToNow, isPast, isToday, isTomorrow } from 'date-fns'
import {
  ClipboardList, Clock, CheckCircle2, FileText, ListChecks,
  ArrowRight, CalendarClock, ChevronRight, Timer, UserCheck, Plane, CornerUpRight,
  CalendarDays, Video, Users, Sparkles,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const CORETIME_URL = 'https://time.coreflow.build'

const SOURCE_LABEL: Record<string, string> = {
  design_review: 'Design review', meeting: 'Meeting', email: 'Email', manual: 'Manual',
}

// A due-date pill (rose = overdue, amber = ≤3 days, slate otherwise).
function DuePill({ due }: { due: string | null }) {
  if (!due) return null
  const d = new Date(due)
  const overdue = isPast(d)
  const soon = !overdue && (d.getTime() - Date.now()) < 3 * 864e5
  const cls = overdue ? 'bg-red-100 text-red-700' : soon ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {overdue ? `Overdue` : `Due ${format(d, 'd MMM')}`}
    </span>
  )
}

function docDotClass(status: string): string {
  return status === 'completed' ? 'bg-emerald-500' : status === 'in_progress' ? 'bg-amber-400' : 'bg-slate-300'
}

// A batch row in the "Reviews in Progress" panel — expandable to per-document status.
function ProgressBatch({ b, reviewers }: { b: CockpitBatch; reviewers: Reviewer[] }) {
  const pct = b.docCount ? Math.round((b.reviewedCount / b.docCount) * 100) : 0
  return (
    <details className="group border-b border-slate-50 last:border-0 open:bg-slate-50/40">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-slate-50">
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-slate-800">{b.packageName}</div>
          <div className="mt-0.5 text-xs text-slate-400">{b.reviewedCount}/{b.docCount} reviewed{b.vendorName ? ` · ${b.vendorName}` : ''}</div>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {b.isOverdue && <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Overdue</span>}
      </summary>
      <div className="space-y-0.5 px-4 pb-3 pl-11">
        {b.docs.map((d) => (
          <div key={d.taskId} className="flex items-center gap-2 py-1 text-xs">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${docDotClass(d.status)}`} />
            <span className="truncate font-mono text-slate-600">{d.label}</span>
            {d.revision && <span className="shrink-0 rounded bg-navy-50 px-1 font-mono text-navy-600">Rev {d.revision}</span>}
            {d.outcome && <span className="shrink-0 rounded bg-emerald-50 px-1.5 font-bold text-emerald-700">{d.outcome}</span>}
            <span className="ml-auto shrink-0 text-slate-400">
              {d.status === 'completed' ? 'reviewed' : d.status === 'in_progress' ? 'in review' : d.status}
            </span>
            <RouteButton kind="doc" documentVersionId={d.versionId} documentNumber={d.label}
              packageCode={b.packageName} reviewers={reviewers} />
          </div>
        ))}
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <Link href={`/reviews/${b.firstTaskId}`}
            className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900">
            Open review workspace <ArrowRight className="h-3 w-3" />
          </Link>
          <RouteButton kind="batch" batchId={b.key} packageCode={b.packageName}
            reviewers={reviewers} label="Route entire batch" />
        </div>
      </div>
    </details>
  )
}

function weekLabel(w: string): string {
  try { return format(new Date(w + 'T00:00:00'), 'd MMM') } catch { return w }
}

// "Tomorrow · 10:00" / "Today · 14:30" / "Fri · 09:00" — day-only meetings drop the time.
function whenLabel(m: MeetingItem): string {
  if (!m.start) return ''
  const d = new Date(m.start.length <= 10 ? m.start + 'T00:00:00' : m.start)
  const day = isToday(d) ? 'Today' : isTomorrow(d) ? 'Tomorrow' : format(d, 'EEE d MMM')
  return m.allDay ? day : `${day} · ${format(d, 'HH:mm')}`
}

function relevantCount(m: MeetingItem, actions: CockpitAction[]): number {
  if (!m.packageHint) return 0
  const h = m.packageHint.toUpperCase()
  return actions.filter((a) => (a.documentNumber ?? '').toUpperCase().includes(h) || (a.title ?? '').toUpperCase().includes(h)).length
}

function MeetingPrepPanel({ meetings, graphAuthorised, actions }: {
  meetings: MeetingItem[]; graphAuthorised: boolean; actions: CockpitAction[]
}) {
  return (
    <section className="card overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal-600"><CalendarDays className="h-4 w-4" /></span>
        <h2 className="font-semibold text-slate-900">Meeting Prep <span className="font-normal text-slate-400">· next 48h</span></h2>
        <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{meetings.length}</span>
      </div>
      {meetings.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          {graphAuthorised
            ? 'No meetings in the next 48 hours.'
            : 'Calendar not connected yet — ask an admin to grant CoreDocs “Calendars.Read” so your Outlook meetings show here.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {meetings.map((m) => {
            const rel = relevantCount(m, actions)
            return (
              <div key={m.id} className="px-5 py-3.5">
                <div className="flex items-center gap-2 text-xs font-bold text-teal-700">
                  <Clock className="h-3.5 w-3.5" /> {whenLabel(m)}
                  {m.category && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">{m.category}</span>}
                  {m.packageHint && <span className="rounded bg-navy-50 px-1.5 py-0.5 font-mono text-navy-600">{m.packageHint}</span>}
                  <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-slate-300">{m.source === 'outlook' ? 'Outlook' : 'CoreMeeting'}</span>
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-slate-800">{m.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                  {m.organizer && <span>{m.organizer}</span>}
                  {m.attendeeCount > 0 && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{m.attendeeCount}</span>}
                  {m.joinUrl && (
                    <a href={m.joinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-900">
                      <Video className="h-3 w-3" /> Join
                    </a>
                  )}
                </div>
                {rel > 0 && (
                  <Link href="/engineering-actions" className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:border-sky-300">
                    <Sparkles className="h-3 w-3" /> {rel} of your open item{rel !== 1 ? 's' : ''} relate — prep before this
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// Time & Leave — reads CoreTime (shared DB). Fails soft to a "connecting" state
// when the CoreTime link isn't configured, so the panel never errors.
function TimeLeavePanel({ tl }: { tl: TimeAndLeave }) {
  const total = tl.counts.total
  return (
    <section className="card overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><CalendarClock className="h-4 w-4" /></span>
        <h2 className="font-semibold text-slate-900">Time &amp; Leave</h2>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${!tl.configured ? 'bg-slate-100 text-slate-400' : total > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-600'}`}>
          {!tl.configured ? 'Connecting' : total > 0 ? `${total} to clear` : 'All clear'}
        </span>
      </div>

      {!tl.configured ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          Your timesheets, approvals and leave will land here — the CoreTime link is being switched on.
        </div>
      ) : total === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          <CheckCircle2 className="mx-auto mb-2 h-9 w-9 opacity-30" />
          Nothing outstanding — your time&apos;s booked and no approvals are waiting on you.
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {tl.weeks.length > 0 && (
            <a href={CORETIME_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600"><Timer className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800">Book your own time</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {tl.weeks.length} week{tl.weeks.length !== 1 ? 's' : ''} outstanding · {tl.weeks.map((w) => weekLabel(w.weekStart)).slice(0, 4).join(', ')}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{tl.weeks.length}</span>
            </a>
          )}
          {tl.approvals.map((a) => (
            <a key={`${a.memberName}:${a.weekStart}`} href={CORETIME_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600"><UserCheck className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">Approve {a.memberName}&apos;s timesheet</div>
                <div className="mt-0.5 text-xs text-slate-400">Week of {weekLabel(a.weekStart)} · {a.hours}h · {a.entries} entr{a.entries !== 1 ? 'ies' : 'y'}</div>
              </div>
              <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">Waiting</span>
            </a>
          ))}
          {tl.leave.map((l, i) => (
            <a key={`leave-${i}`} href={CORETIME_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600"><Plane className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">{l.employeeName} — leave request</div>
                <div className="mt-0.5 text-xs text-slate-400">{l.days} day{l.days !== 1 ? 's' : ''}{l.leaveType ? ` · ${l.leaveType}` : ''}{l.stage === 'final' ? ' · final sign-off' : ''}</div>
              </div>
              <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">Approve</span>
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email, full_name').eq('auth_user_id', user?.id ?? '').single()
  const email = profile?.email ?? ''
  const firstName = (profile?.full_name ?? email).split(' ')[0] || 'there'

  const [cockpit, timeLeave, routed, , reviewersRes, meetingsData] = await Promise.all([
    getCockpitData(email),
    getTimeAndLeave(email),
    getRoutedToMe(email),
    getRoutedByMeCount(email),
    db.from('users').select('email, full_name').eq('active', true).order('full_name').limit(1000),
    getUpcomingMeetings(email),
  ])
  const { reviewQueue, inProgress, actions, counts } = cockpit
  const reviewers: Reviewer[] = (reviewersRes.data ?? [])
    .map((u) => ({ email: (u.email as string) ?? '', name: (u.full_name as string) || (u.email as string) || '' }))
    .filter((u) => u.email && u.email.toLowerCase() !== email.toLowerCase())

  const chips = [
    { show: counts.overdue > 0, n: counts.overdue, label: 'overdue', dot: 'bg-red-500' },
    { show: routed.count > 0, n: routed.count, label: 'routed to you', dot: 'bg-violet-500' },
    { show: counts.queueBatches > 0, n: counts.queueBatches, label: 'to start', dot: 'bg-amber-500' },
    { show: counts.inProgressBatches > 0, n: counts.inProgressBatches, label: 'in progress', dot: 'bg-teal-500' },
    { show: counts.actionsOpen > 0, n: counts.actionsOpen, label: 'action items', dot: 'bg-sky-500' },
    { show: meetingsData.meetings.length > 0, n: meetingsData.meetings.length, label: 'meetings in 48h', dot: 'bg-cyan-500' },
    { show: timeLeave.counts.total > 0, n: timeLeave.counts.total, label: 'time & leave', dot: 'bg-indigo-500' },
    { show: counts.queued > 0, n: counts.queued, label: 'queued for later', dot: 'bg-slate-400' },
  ].filter((c) => c.show)

  return (
    <div className="space-y-5">
      {/* Personal line + colour-coded, in-screen summary (no email needed) */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Actions</h1>
          <p className="mt-1 text-sm text-slate-500">Everything waiting on you, {firstName} — in one place.</p>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-500 shadow-sm">
                <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                <span className="tabular-nums text-slate-900">{c.n}</span> {c.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        {/* ================= LEFT — review work ================= */}
        <div className="space-y-5">
          {/* Routed to you — incoming hand-offs from colleagues */}
          {routed.count > 0 && (
            <section className="card overflow-hidden p-0 ring-1 ring-violet-200">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-violet-50/50 px-5 py-3.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 text-violet-600"><CornerUpRight className="h-4 w-4" /></span>
                <h2 className="font-semibold text-slate-900">Routed to you</h2>
                <span className="ml-auto rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">{routed.count} new</span>
              </div>
              <div className="divide-y divide-slate-50">
                {routed.items.map((it) => <RoutedRow key={it.id} item={it} />)}
              </div>
            </section>
          )}

          {/* Review Queue */}
          <section className="card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-600"><ClipboardList className="h-4 w-4" /></span>
              <h2 className="font-semibold text-slate-900">Review Queue</h2>
              <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                {counts.queueBatches} batch{counts.queueBatches !== 1 ? 'es' : ''} · {counts.queueDocs} doc{counts.queueDocs !== 1 ? 's' : ''}
              </span>
            </div>
            {reviewQueue.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">
                <CheckCircle2 className="mx-auto mb-2 h-9 w-9 opacity-30" />
                Nothing waiting to start — you&apos;re on top of your queue.
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {reviewQueue.map((b) => (
                  <Link key={b.key} href={`/reviews/${b.firstTaskId}`}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${b.isOverdue ? 'bg-red-100 text-red-700' : 'bg-navy-100 text-navy-700'}`}>{b.seq}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-800">{b.packageName}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500"><FileText className="h-3 w-3" />{b.docCount}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-400">
                        {b.vendorName ? `${b.vendorName} · ` : ''}{b.latestSent ? `Sent ${formatDistanceToNow(new Date(b.latestSent), { addSuffix: true })}` : 'Assigned to you'}
                      </div>
                    </div>
                    <DuePill due={b.earliestDue} />
                    <span className="hidden shrink-0 items-center gap-1 text-sm font-bold text-teal-700 sm:inline-flex">Start <ArrowRight className="h-3.5 w-3.5" /></span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Reviews in Progress */}
          <section className="card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal-600"><Clock className="h-4 w-4" /></span>
              <h2 className="font-semibold text-slate-900">Reviews in Progress</h2>
              <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{counts.inProgressBatches} started</span>
            </div>
            {inProgress.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">Nothing in progress. Start a batch from your queue above.</div>
            ) : (
              <div>{inProgress.map((b) => <ProgressBatch key={b.key} b={b} reviewers={reviewers} />)}</div>
            )}
          </section>
        </div>

        {/* ================= RIGHT — actions · time ================= */}
        <div className="space-y-5">
          {/* My Action Items */}
          <section className="card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-600"><ListChecks className="h-4 w-4" /></span>
              <h2 className="font-semibold text-slate-900">My Action Items</h2>
              <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{counts.actionsOpen} open</span>
            </div>
            {actions.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">
                <CheckCircle2 className="mx-auto mb-2 h-9 w-9 opacity-30" />
                No action items on your name.
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {actions.map((a) => (
                  <Link key={a.id} href="/engineering-actions" className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.priority === 'high' ? 'bg-red-500' : a.priority === 'medium' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800">{a.title}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-400">
                        {a.ref ? <span className="font-mono">{a.ref}</span> : null}
                        {a.source ? ` · ${SOURCE_LABEL[a.source] ?? a.source}` : ''}
                        {a.documentNumber ? ` · ${a.documentNumber}` : ''}
                      </div>
                    </div>
                    <DuePill due={a.dueDate} />
                  </Link>
                ))}
              </div>
            )}
            <Link href="/engineering-actions" className="flex items-center justify-center gap-1 border-t border-slate-100 px-5 py-2.5 text-xs font-bold text-teal-700 hover:bg-teal-50">
              Open Engineering Actions <ArrowRight className="h-3 w-3" />
            </Link>
          </section>

          {/* Meeting Prep — next 48h from Outlook (Graph) + CoreMeeting, fail-soft */}
          <MeetingPrepPanel meetings={meetingsData.meetings} graphAuthorised={meetingsData.graphAuthorised} actions={actions} />

          {/* Time & Leave — live from CoreTime (shared DB), fail-soft */}
          <TimeLeavePanel tl={timeLeave} />
        </div>
      </div>

      {/* Engineering Room — project-wide live chat */}
      <ChatDock me={{ email, name: profile?.full_name ?? email }} people={reviewers} canClear={isChatAdmin(email)} />
    </div>
  )
}
