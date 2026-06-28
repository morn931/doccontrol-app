import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPermissions, can, FK } from '@/lib/permissions'
import { PermissionsTable } from './permissions-table'
import type { Access, PermRow, Section } from './permissions-table'

export const dynamic = 'force-dynamic'

const ROLES = ['admin', 'document_controller', 'reviewer', 'engineering_manager', 'project_manager', 'vendor'] as const
type Role = typeof ROLES[number]
type ColKey = 'adm' | 'dc' | 'rev' | 'em' | 'pm' | 'ven'
const ROLE_COL: Record<Role, ColKey> = {
  admin: 'adm', document_controller: 'dc', reviewer: 'rev',
  engineering_manager: 'em', project_manager: 'pm', vendor: 'ven',
}

function makeRow(
  label: string,
  featureKey: string | null,
  perms: ReturnType<typeof Map<string, boolean>>,
  overrides: Partial<Record<ColKey, 'on' | 'off'>> = {},
  note?: string,
): PermRow {
  function cell(role: Role): Access {
    const col = ROLE_COL[role]
    const override = overrides[col]
    if (override === 'on')  return 'locked-on'
    if (override === 'off') return 'locked-off'
    if (featureKey === null) return 'locked-off'
    return can(perms, featureKey, role) ? 'yes' : 'no'
  }
  return {
    label, note, featureKey,
    adm: cell('admin'),
    dc:  cell('document_controller'),
    rev: cell('reviewer'),
    em:  cell('engineering_manager'),
    pm:  cell('project_manager'),
    ven: cell('vendor'),
    dev: 'locked-on',
  }
}

export default async function PermissionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  if (!me || me.role !== 'developer') redirect('/dashboard')

  const perms = await getPermissions(supabase)
  const r = (label: string, fk: string | null, overrides?: Parameters<typeof makeRow>[3], note?: string) =>
    makeRow(label, fk, perms, overrides, note)

  const SECTIONS: Section[] = [
    {
      title: 'Navigation',
      rows: [
        r('Dashboard',        null, { adm: 'on', dc: 'on', rev: 'on', em: 'on', pm: 'on', ven: 'on' }),
        r('Incoming Batches', FK.NAV_BATCHES),
        r('My Reviews',       FK.NAV_REVIEWS),
        r('Transmittals',     FK.NAV_TRANSMITTALS),
        r('Document Search',  null, { adm: 'on', dc: 'on', rev: 'on', em: 'on', pm: 'on', ven: 'on' }),
        r('MDDR',             FK.NAV_MDDR),
        r('Reporting',        FK.NAV_REPORTING),
        r('User Guide',       null, { adm: 'on', dc: 'on', rev: 'on', em: 'on', pm: 'on', ven: 'on' }),
        r('Developer Tools',  null, { adm: 'off', dc: 'off', rev: 'off', em: 'off', pm: 'off', ven: 'off' }),
      ],
    },
    {
      title: 'Admin Section',
      rows: [
        r('Import & Sync',      FK.NAV_ADMIN),
        r('Manage Users',       FK.NAV_ADMIN),
        r('Vendors & Packages', FK.NAV_ADMIN),
      ],
    },
    {
      title: 'Batches',
      rows: [
        r('View & open batches',         FK.NAV_BATCHES),
        r('Assign reviewers',            FK.ACTION_ASSIGN_REVIEWERS),
        r('Reject batch (pre-review)',   FK.ACTION_REJECT_BATCH),
        r('Generate & send transmittal', FK.ACTION_GENERATE_TRANSMITTAL),
      ],
    },
    {
      title: 'Reviews',
      rows: [
        r('View my review tasks',  FK.NAV_REVIEWS),
        r('Submit review outcome', FK.ACTION_SUBMIT_REVIEW),
      ],
    },
    {
      title: 'Transmittals',
      rows: [
        r('View transmittals', FK.NAV_TRANSMITTALS),
      ],
    },
    {
      title: 'Document Search',
      rows: [
        r('Search & view documents', null, { adm: 'on', dc: 'on', rev: 'on', em: 'on', pm: 'on', ven: 'on' }),
      ],
    },
    {
      title: 'MDDR',
      rows: [
        r('View MDDR',                FK.NAV_MDDR),
        r('Upload / refresh register', FK.ACTION_UPLOAD_REGISTER),
        r('Sync from live review data',FK.ACTION_MDDR_SYNC),
      ],
    },
    {
      title: 'Reporting',
      rows: [
        r('View all reports', FK.NAV_REPORTING),
      ],
    },
    {
      title: 'Developer Tools',
      rows: [
        r('Role Permissions matrix', null, { adm: 'off', dc: 'off', rev: 'off', em: 'off', pm: 'off', ven: 'off' }),
      ],
    },
  ]

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
          Click any checkbox to grant or revoke access. Changes take effect immediately — no redeploy needed.
        </p>
      </div>

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
        Developer always has full access. Dashboard, Document Search, and User Guide are universal — they cannot be revoked.
        Developer Tools cannot be granted to non-developer roles.
      </p>
    </div>
  )
}
