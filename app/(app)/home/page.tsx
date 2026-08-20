import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCockpitData, type CockpitBatch } from '@/lib/cockpit'
import Link from 'next/link'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import {
  ClipboardList, Clock, CheckCircle2, AlertTriangle, FileText, ListChecks,
  ArrowRight, CalendarClock, ChevronRight,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

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
function ProgressBatch({ b }: { b: CockpitBatch }) {
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
          </div>
        ))}
        <Link href={`/reviews/${b.firstTaskId}`}
          className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900">
          Open review workspace <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </details>
  )
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email, full_name').eq('auth_user_id', user?.id ?? '').single()
  const email = profile?.email ?? ''
  const firstName = (profile?.full_name ?? email).split(' ')[0] || 'there'

  const { reviewQueue, inProgress, actions, counts } = await getCockpitData(email)

  const chips = [
    { show: counts.overdue > 0, n: counts.overdue, label: 'overdue', dot: 'bg-red-500' },
    { show: counts.queueBatches > 0, n: counts.queueBatches, label: 'to start', dot: 'bg-amber-500' },
    { show: counts.inProgressBatches > 0, n: counts.inProgressBatches, label: 'in progress', dot: 'bg-teal-500' },
    { show: counts.actionsOpen > 0, n: counts.actionsOpen, label: 'action items', dot: 'bg-sky-500' },
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
              <div>{inProgress.map((b) => <ProgressBatch key={b.key} b={b} />)}</div>
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

          {/* Time & Leave — cross-database panel, wired next (CoreTime) */}
          <section className="card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500"><CalendarClock className="h-4 w-4" /></span>
              <h2 className="font-semibold text-slate-900">Time &amp; Leave</h2>
              <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-400">Connecting</span>
            </div>
            <div className="px-5 py-8 text-center text-sm text-slate-400">
              Your timesheets to book, approvals waiting on you and leave requests will land here — wiring the CoreTime link next.
            </div>
          </section>
        </div>
      </div>

      {/* roadmap note — the panels still to come, so the page reads as a plan in motion */}
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Coming next on this page: route documents to other reviewers · in-screen notifications · meeting prep · live engineering chat.
      </p>
    </div>
  )
}
