import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FileText, Inbox, Clock, CheckCircle, Send, AlertTriangle, RotateCcw, XCircle } from 'lucide-react'
import { BATCH_STATUS_LABELS, BATCH_STATUS_COLORS } from '@/lib/utils/batch-status'
import { format, formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import Image from 'next/image'
import type { UserRole } from '@/lib/types/database'
import { getPermissions, can, FK } from '@/lib/permissions'

async function getNavPerms() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name')
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
  }
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
    <div className={`card p-5 ${href ? 'hover:shadow-md hover:border-teal-300 transition-all cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{label}</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{value ?? 0}</p>
        </div>
        <div className={`flex items-center justify-center w-12 h-12 rounded-full border-2 ${t.ring}`}>
          <Icon className={`h-5 w-5 ${t.icon}`} strokeWidth={1.5} />
        </div>
      </div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

const cardCls = 'group flex flex-col items-center gap-3 rounded-xl bg-white border border-slate-200 p-3 shadow-sm hover:border-teal-300 hover:shadow-md transition-all text-center'
const iconCls = 'h-32 w-32 rounded-2xl object-cover transition-transform duration-200 group-hover:scale-105'

function QuickAccessCard({ href, icon, label, blurb }: { href: string; icon: string; label: string; blurb: string }) {
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

export default async function DashboardPage() {
  const { awaitingAction, inReview, reviewComplete, returned, rejected, recentBatches, overdueReviews } =
    await getDashboardStats()
  const navPerms = await getNavPerms()

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-xl bg-[#02335E] bg-cover bg-center bg-no-repeat px-7 py-6 flex items-center justify-between gap-4 sm:bg-[url('/coreflow/header/backgrounds/hero-industrial-desktop-1920w.png')] max-sm:bg-[url('/coreflow/header/backgrounds/hero-industrial-mobile-780x1040@2x.png')] max-sm:bg-bottom">
        <div>
          <p className="text-white/80 text-sm mb-0.5">Welcome back</p>
          <h1 className="text-2xl font-bold text-white">{navPerms.firstName}!</h1>
        </div>
        <p className="text-white/70 text-sm hidden sm:block">
          {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Quick access */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <QuickAccessCard href="/documents" icon="/dashboard-card-icons/512/CD-01_Documents.png" label="Document Search" blurb="Find any document" />
        {navPerms.transmittals && (
          <QuickAccessCard href="/transmittals" icon="/dashboard-card-icons/512/CD-02_Transmittals.png" label="Transmittals" blurb="Vendor transmittal register" />
        )}
        {navPerms.reviews && (
          <QuickAccessCard href="/reviews" icon="/dashboard-card-icons/512/CD-03_Review-Queue.png" label="My Reviews" blurb="Review queue" />
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

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">PPE Tech Document Control Overview</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Awaiting Action"   value={awaitingAction}  icon={Inbox}        tone="teal"    href="/batches?status=pending" />
        <StatCard label="In Review"         value={inReview}        icon={Clock}        tone="amber"   href="/batches?status=in_review" />
        <StatCard label="Ready to Return"   value={reviewComplete}  icon={CheckCircle}  tone="emerald" href="/batches?status=complete" />
        <StatCard label="Returned to Vendor" value={returned}       icon={Send}         tone="sky"     href="/batches?status=returned" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Rejected Batches"  value={rejected}        icon={XCircle}      tone="rose"    href="/batches?status=rejected" />
        <StatCard label="Overdue Reviews"   value={overdueReviews}  icon={AlertTriangle} tone="amber"  href="/reviews?status=overdue" />
      </div>

      {/* Recent batches */}
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Recent Batches</h2>
          <Link href="/batches" className="text-sm text-navy-600 hover:text-navy-800 font-medium">View all →</Link>
        </div>
        <div className="divide-y divide-slate-50">
          {!recentBatches?.length && (
            <div className="px-6 py-10 text-center text-slate-400">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>No batches yet. Run the import or connect the intake webhook.</p>
            </div>
          )}
          {recentBatches?.map((batch: any) => (
            <Link key={batch.id} href={`/batches/${batch.id}`}
              className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-900 truncate">
                    {batch.packages?.package_name ?? batch.packages?.package_code ?? 'Unknown Package'}
                  </p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${BATCH_STATUS_COLORS[batch.status as keyof typeof BATCH_STATUS_COLORS] ?? 'bg-slate-100 text-slate-600'}`}>
                    {BATCH_STATUS_LABELS[batch.status as keyof typeof BATCH_STATUS_LABELS] ?? batch.status}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {batch.vendors?.name ?? 'Unknown Vendor'} · {batch.file_count} file{batch.file_count !== 1 ? 's' : ''} ·{' '}
                  {formatDistanceToNow(new Date(batch.received_at), { addSuffix: true })}
                </p>
              </div>
              <span className="text-slate-300 text-lg">›</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
