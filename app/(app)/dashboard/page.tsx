import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Inbox, Clock, CheckCircle, Send, AlertTriangle, XCircle } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import type { UserRole } from '@/lib/types/database'
import { getPermissions, can, FK } from '@/lib/permissions'
import { ACTIONABLE_REVIEW_STATUSES } from '@/lib/utils/review-status'
import { RecentBatches } from './recent-batches'

async function getNavPerms() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name, email')
    .eq('auth_user_id', user.id)
    .single()

  const role = (profile?.role ?? 'reviewer') as UserRole
  const perms = await getPermissions(supabase)
  return {
    reviews:      can(perms, FK.NAV_REVIEWS,      role),
    transmittals: can(perms, FK.NAV_TRANSMITTALS, role),
    mddr:         can(perms, FK.NAV_MDDR,         role),
    reporting:    can(perms, FK.NAV_REPORTING,    role),
    admin:        can(perms, FK.NAV_ADMIN,        role),
    firstName:    ((profile?.full_name as string | null) ?? '').split(' ')[0] || 'there',
    email:        (profile?.email as string | null) ?? '',
  }
}

/** Exact count of the signed-in reviewer's actionable (not-yet-actioned) review
 *  tasks — same definition as /reviews (ACTIONABLE_REVIEW_STATUSES): sent, opened,
 *  in_progress, overdue. Excludes 'pending' (not yet this reviewer's turn) and
 *  'completed'. Counts individual document review tasks, not batches. */
async function getMyReviewsCount(email: string): Promise<number> {
  if (!email) return 0
  const db = createServiceClient()
  const { count } = await db
    .from('review_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('reviewer_email', email)
    .in('status', ACTIONABLE_REVIEW_STATUSES)
  return count ?? 0
}

async function getDashboardStats() {
  const db = createServiceClient()

  const [
    { count: awaitingAction },
    { count: inReview },
    { count: reviewComplete },
    { count: returned },
    { count: rejected },
    { data: recentBatches },
    { count: overdueReviews },
  ] = await Promise.all([
    db.from('batches').select('*', { count: 'exact', head: true })
      .in('status', ['intake_received','metadata_pending','ready_for_reviewer_assignment']),
    db.from('batches').select('*', { count: 'exact', head: true })
      .in('status', ['review_in_progress','review_ready_to_start']),
    db.from('batches').select('*', { count: 'exact', head: true })
      .in('status', ['review_complete','transmittal_generated']),
    db.from('batches').select('*', { count: 'exact', head: true })
      .eq('status', 'returned_to_vendor'),
    db.from('batches').select('*', { count: 'exact', head: true })
      .eq('status', 'rejected_before_review'),
    db.from('batches')
      .select(`id, batch_guid, status, received_at, file_count, vendor_id,
               vendors(name, code), packages(package_code, package_name)`)
      .order('received_at', { ascending: false })
      .limit(8),
    db.from('review_tasks').select('*', { count: 'exact', head: true })
      .eq('status', 'overdue'),
  ])

  return { awaitingAction, inReview, reviewComplete, returned, rejected, recentBatches, overdueReviews }
}

// Soft, CoreTime-aligned icon treatment: thin-outlined circle ring + muted icon
// (no solid vibrant fills). Teal-forward, with restrained amber/rose for warnings.
const STAT_TONES: Record<string, { ring: string; icon: string }> = {
  teal:    { ring: 'border-teal-200',    icon: 'text-teal-600' },
  amber:   { ring: 'border-amber-200',   icon: 'text-amber-600' },
  emerald: { ring: 'border-emerald-200', icon: 'text-emerald-600' },
  sky:     { ring: 'border-sky-200',     icon: 'text-sky-600' },
  rose:    { ring: 'border-rose-200',    icon: 'text-rose-500' },
  slate:   { ring: 'border-slate-200',   icon: 'text-slate-400' },
}
interface StatCardProps {
  label: string; value: number | null
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  tone?: keyof typeof STAT_TONES; href?: string
}
function StatCard({ label, value, icon: Icon, tone = 'teal', href }: StatCardProps) {
  const t = STAT_TONES[tone]
  const content = (
    <div className={`card p-3 ${href ? 'hover:shadow-md hover:border-teal-300 transition-all cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500 font-medium">{label}</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{value ?? 0}</p>
        </div>
        <div className={`flex items-center justify-center w-9 h-9 rounded-full border-2 shrink-0 ${t.ring}`}>
          <Icon className={`h-4 w-4 ${t.icon}`} strokeWidth={1.5} />
        </div>
      </div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

const cardCls = 'group relative flex w-56 shrink-0 flex-col items-center gap-3 rounded-xl bg-white border border-slate-200 p-3 shadow-sm hover:border-teal-300 hover:shadow-md transition-all text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500'
const cardClsActive = 'group relative flex w-56 shrink-0 flex-col items-center gap-3 rounded-xl bg-brand border border-brand p-3 shadow-sm hover:border-brand-dark hover:shadow-md transition-all text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark'
const iconCls = 'h-32 w-32 rounded-2xl object-cover transition-transform duration-200 group-hover:scale-105'
const iconInsetCls = 'flex h-32 w-32 items-center justify-center rounded-2xl bg-white p-3 transition-transform duration-200 group-hover:scale-105'

function QuickAccessCard({ href, icon, label, blurb, count }: { href: string; icon: string; label: string; blurb: string; count?: number }) {
  const active = (count ?? 0) > 0

  if (!active) {
    return (
      <Link href={href} className={cardCls}>
        <Image src={icon} alt="" width={128} height={128} className={iconCls} />
        <div>
          <span className="text-sm font-semibold text-[#0B3563] group-hover:text-teal-700 block">{label}</span>
          <span className="text-xs text-slate-500 mt-0.5 block">{blurb}</span>
        </div>
      </Link>
    )
  }

  const documentsLabel = count === 1 ? '1 document needs review' : `${count} documents need review`
  return (
    <Link href={href} className={cardClsActive}>
      <span className="absolute -top-2 -right-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-[#1B3464] px-1.5 text-xs font-bold text-white shadow">
        {count}
      </span>
      <div className={iconInsetCls}>
        <Image src={icon} alt="" width={128} height={128} className="h-full w-full rounded-xl object-cover" />
      </div>
      <div>
        <span className="text-sm font-semibold text-white block">{label}</span>
        <span className="text-xs text-teal-50 mt-0.5 block">{documentsLabel}</span>
      </div>
    </Link>
  )
}

export default async function DashboardPage() {
  const { awaitingAction, inReview, reviewComplete, returned, rejected, recentBatches, overdueReviews } =
    await getDashboardStats()
  const navPerms = await getNavPerms()
  const myReviewsCount = navPerms.reviews ? await getMyReviewsCount(navPerms.email) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">PPE Tech Document Control Overview</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Awaiting Action"   value={awaitingAction}  icon={Inbox}        tone="teal"    href="/batches?status=pending" />
        <StatCard label="In Review"         value={inReview}        icon={Clock}        tone="amber"   href="/batches?status=in_review" />
        <StatCard label="Ready to Return"   value={reviewComplete}  icon={CheckCircle}  tone="emerald" href="/batches?status=complete" />
        <StatCard label="Returned to Vendor" value={returned}       icon={Send}         tone="sky"     href="/batches?status=returned" />
        <StatCard label="Rejected Batches"  value={rejected}        icon={XCircle}      tone="rose"    href="/batches?status=rejected" />
        <StatCard label="Overdue Reviews"   value={overdueReviews}  icon={AlertTriangle} tone="amber"  href="/reviews?status=overdue" />
      </div>

      {/* Quick access — capped to exactly 4 card-widths so a 7th tile wraps to a
          centered second row of 3 instead of spreading across the full-width page. */}
      <div className="mx-auto flex max-w-[944px] flex-wrap justify-center gap-4">
        <QuickAccessCard href="/documents" icon="/dashboard-card-icons/512/CD-01_Documents.png" label="Document Search" blurb="Find any document" />
        {navPerms.transmittals && (
          <QuickAccessCard href="/transmittals" icon="/dashboard-card-icons/512/CD-02_Transmittals.png" label="Transmittals" blurb="Vendor transmittal register" />
        )}
        {navPerms.reviews && (
          <QuickAccessCard href="/reviews" icon="/dashboard-card-icons/512/CD-03_Review-Queue.png" label="My Reviews" blurb="Review queue" count={myReviewsCount} />
        )}
        {navPerms.mddr && (
          <QuickAccessCard href="/mddr" icon="/dashboard-card-icons/512/CD-04_MDDR.png" label="MDDR" blurb="Master deliverable register" />
        )}
        {navPerms.admin && (
          <QuickAccessCard href="/admin/import" icon="/dashboard-card-icons/512/CD-05_Import-Register.png" label="Import & Sync" blurb="Batch intake, SharePoint sync" />
        )}
        {navPerms.admin && (
          <QuickAccessCard href="/admin/vendors" icon="/dashboard-card-icons/512/CD-06_Vendors.png" label="Vendors & Packages" blurb="Manage vendors and packages" />
        )}
        {navPerms.reporting && (
          <QuickAccessCard href="/reporting" icon="/dashboard-card-icons/512/CD-07_Document-Reporting.png" label="Reporting" blurb="Engineering & progress reports" />
        )}
      </div>

      {/* Recent batches */}
      <RecentBatches recentBatches={recentBatches} />
    </div>
  )
}
