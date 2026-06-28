import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PermissionsTable } from './permissions-table'
import type { PermRow, Section } from './permissions-table'

export const dynamic = 'force-dynamic'

// Shorthand row builder.
// on/off overrides per role; omit = role has no access by default.
// Developer always gets locked-on (full access).
function r(
  label: string,
  access: { adm?: boolean; dc?: boolean; rev?: boolean; em?: boolean; pm?: boolean; ven?: boolean },
  note?: string,
): PermRow {
  const cell = (v?: boolean) => v ? 'yes' : 'no'
  return {
    label,
    note,
    adm: cell(access.adm),
    dc:  cell(access.dc),
    rev: cell(access.rev),
    em:  cell(access.em),
    pm:  cell(access.pm),
    ven: cell(access.ven),
    dev: 'locked-on',
  }
}

// Universal = everyone (except vendor where noted)
const ALL: PermRow['adm'] = 'locked-on'

function rAll(label: string, includeVendor = true, note?: string): PermRow {
  return { label, note, adm: ALL, dc: ALL, rev: ALL, em: ALL, pm: ALL, ven: includeVendor ? ALL : 'locked-off', dev: ALL }
}

const SECTIONS: Section[] = [
  {
    title: 'Navigation',
    rows: [
      rAll('Dashboard'),
      r('Incoming Batches',  { adm: true, dc: true }),
      r('My Reviews',        { adm: true, dc: true, rev: true, em: true }),
      r('Transmittals',      { adm: true, dc: true, pm: true }),
      rAll('Document Search'),
      r('MDDR',              { adm: true, dc: true, em: true, pm: true }),
      r('Reporting',         { adm: true, dc: true, em: true, pm: true }),
      rAll('User Guide'),
      { label: 'Developer Tools', adm: 'locked-off', dc: 'locked-off', rev: 'locked-off', em: 'locked-off', pm: 'locked-off', ven: 'locked-off', dev: 'locked-on' },
    ],
  },
  {
    title: 'Admin Section',
    rows: [
      r('Import & Sync',      { adm: true }, 'Trigger SharePoint intake scan'),
      r('Manage Users',       { adm: true }, 'Add, edit roles, deactivate'),
      r('Vendors & Packages', { adm: true }),
    ],
  },
  {
    title: 'Batches',
    rows: [
      r('View batch list',              { adm: true, dc: true }),
      r('Open / view batch detail',     { adm: true, dc: true }),
      r('Assign reviewers',             { adm: true, dc: true }),
      r('Reject batch (pre-review)',    { adm: true, dc: true }),
      r('Generate & send transmittal',  { adm: true, dc: true }),
    ],
  },
  {
    title: 'Reviews',
    rows: [
      r('View my review tasks',    { adm: true, dc: true, rev: true, em: true }),
      r('Submit review outcome',   { adm: true, dc: true, rev: true, em: true }),
    ],
  },
  {
    title: 'Transmittals',
    rows: [
      r('View transmittal list',   { adm: true, dc: true, pm: true }),
      r('View transmittal detail', { adm: true, dc: true, pm: true }),
    ],
  },
  {
    title: 'Document Search',
    rows: [
      rAll('Search documents'),
      rAll('View document detail'),
      rAll('Download / open document'),
    ],
  },
  {
    title: 'MDDR',
    rows: [
      r('View MDDR',              { adm: true, dc: true, em: true, pm: true }),
      r('Upload / refresh register', { adm: true, dc: true }, 'Admin & Doc Controller only'),
      r('Sync MDDR from live review data', { adm: true, dc: true }),
    ],
  },
  {
    title: 'Reporting',
    rows: [
      r('Overview dashboard',     { adm: true, dc: true, em: true, pm: true }),
      r('Engineering Tracker',    { adm: true, dc: true, em: true, pm: true }),
      r('Package Progress',       { adm: true, dc: true, em: true, pm: true }),
      r('Phase 1 Deliverables',   { adm: true, dc: true, em: true, pm: true }),
      r('P6 Export',              { adm: true, dc: true, em: true, pm: true }),
    ],
  },
  {
    title: 'Developer Tools',
    rows: [
      { label: 'Role Permissions matrix', adm: 'locked-off', dc: 'locked-off', rev: 'locked-off', em: 'locked-off', pm: 'locked-off', ven: 'locked-off', dev: 'locked-on' },
    ],
  },
]

export default async function PermissionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  if (!me || me.role !== 'developer') redirect('/dashboard')

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href="/developer" className="text-sm text-slate-500 hover:text-teal-700 transition-colors">
          ← Developer Tools
        </Link>
      </div>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Role Permissions</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Reference matrix for all roles in CoreDocs. Developer has full access to everything.
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mb-5 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 20 20" className="w-4 h-4 flex-shrink-0">
            <rect x="2" y="2" width="16" height="16" rx="4" fill="#0d9488" />
            <path d="M6 10l2.5 2.5L14 7.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          Allowed
        </span>
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 20 20" className="w-4 h-4 flex-shrink-0">
            <rect x="2" y="2" width="16" height="16" rx="4" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
          </svg>
          Blocked
        </span>
        <span className="flex items-center gap-1.5 text-slate-400">
          <svg viewBox="0 0 20 20" className="w-4 h-4 flex-shrink-0 opacity-30">
            <rect x="2" y="2" width="16" height="16" rx="4" fill="#0d9488" />
            <path d="M6 10l2.5 2.5L14 7.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          Faded = hardcoded (universal or dev-only)
        </span>
      </div>

      <PermissionsTable sections={SECTIONS} />

      <p className="text-[11px] text-slate-400 mt-3 pl-1">
        Developer role always has full access to every feature.
        Greyed rows are hardcoded — universal features (like Dashboard) cannot be revoked,
        and Developer Tools cannot be granted to non-developer roles.
      </p>
    </div>
  )
}
