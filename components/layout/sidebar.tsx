'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { UserRole } from '@/lib/types/database'

export interface NavPerms {
  batches:      boolean
  reviews:      boolean
  transmittals: boolean
  mddr:         boolean
  reporting:    boolean
  admin:        boolean
  docRequests:  boolean
}

interface SidebarProps { role: UserRole; navPerms: NavPerms }

const ICON = (name: string) => `/coreflow/icons/${name}/transparent/${name}-48.png`

export function Sidebar({ role, navPerms }: SidebarProps) {
  const pathname = usePathname()
  const dev = role === 'developer'

  function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
    const active = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link href={href} className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-teal-100 text-teal-900' : 'text-slate-600 hover:bg-teal-50 hover:text-teal-900'
      }`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} alt="" className="h-7 w-7 shrink-0 object-contain" />
        {label}
      </Link>
    )
  }

  return (
    <aside className="hidden md:flex w-52 shrink-0 flex-col gap-0.5 rounded-xl border border-slate-200 bg-white py-4 px-2 shadow-sm self-start">
      <nav className="flex flex-col gap-0.5">

        {/* Dashboard — universal */}
        <NavLink href="/dashboard" label="Dashboard" icon={ICON('dashboard')} />

        {/* Permission-gated nav */}
        {(dev || navPerms.batches)      && <NavLink href="/batches"      label="Incoming Batches" icon={ICON('documents')} />}
        {(dev || navPerms.reviews)      && <NavLink href="/reviews"      label="My Reviews"       icon={ICON('actions')} />}
        {(dev || navPerms.transmittals) && <NavLink href="/transmittals" label="Transmittals"     icon={ICON('reports')} />}

        {/* Document Search — universal */}
        <NavLink href="/documents" label="Document Search" icon={ICON('document-search')} />

        {(dev || navPerms.docRequests) && <NavLink href="/documents/requests" label="Document Requests" icon={ICON('documents')} />}

        {(dev || navPerms.mddr)      && <NavLink href="/mddr"      label="MDDR"      icon={ICON('mddr')} />}
        {(dev || navPerms.reporting) && <NavLink href="/reporting" label="Reporting" icon={ICON('reports')} />}

        {/* Admin section */}
        {(dev || navPerms.admin) && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Admin</p>
            </div>
            <NavLink href="/admin/import"  label="Import & Sync"      icon={ICON('administration')} />
            <NavLink href="/admin/users"   label="Users"              icon={ICON('team')} />
            <NavLink href="/admin/vendors" label="Vendors & Packages" icon={ICON('vendors')} />
          </>
        )}

        {/* Dev section */}
        {dev && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Dev</p>
            </div>
            <NavLink href="/developer" label="Developer Tools" icon={ICON('developer-tools')} />
            <NavLink href="/developer/doc-requests" label="Doc Request Email" icon={ICON('documents')} />
          </>
        )}

        {/* User Guide — universal */}
        <div className="mt-4 border-t border-slate-100 pt-2">
          <NavLink href="/help" label="User Guide" icon={ICON('documents')} />
        </div>

      </nav>
    </aside>
  )
}
