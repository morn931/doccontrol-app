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

export function Sidebar({ role, navPerms }: SidebarProps) {
  const pathname = usePathname()
  const dev = role === 'developer'

  function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
    const active = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link href={href} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}>
        <span className="text-base">{icon}</span>
        {label}
      </Link>
    )
  }

  return (
    <aside className="hidden md:flex w-52 bg-white border-r border-slate-200 flex-col py-4 px-3 flex-shrink-0">
      <nav className="flex flex-col gap-0.5">

        {/* Dashboard — universal */}
        <NavLink href="/dashboard" label="Dashboard" icon="🏠" />

        {/* Permission-gated nav */}
        {(dev || navPerms.batches)      && <NavLink href="/batches"      label="Incoming Batches" icon="📥" />}
        {(dev || navPerms.reviews)      && <NavLink href="/reviews"      label="My Reviews"       icon="✅" />}
        {(dev || navPerms.transmittals) && <NavLink href="/transmittals" label="Transmittals"     icon="📤" />}

        {/* Document Search — universal */}
        <NavLink href="/documents" label="Document Search" icon="🔍" />

        {(dev || navPerms.docRequests) && <NavLink href="/documents/requests" label="Document Requests" icon="🔢" />}

        {(dev || navPerms.mddr)      && <NavLink href="/mddr"      label="MDDR"      icon="📋" />}
        {(dev || navPerms.reporting) && <NavLink href="/reporting" label="Reporting" icon="📊" />}

        {/* Aconex — live reports read from Oracle Aconex (read-only) */}
        {(dev || navPerms.reporting) && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Aconex</p>
            </div>
            <NavLink href="/aconex-review" label="Aconex Review Tracker" icon="🔗" />
          </>
        )}

        {/* Admin section */}
        {(dev || navPerms.admin) && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Admin</p>
            </div>
            <NavLink href="/admin/import"  label="Import & Sync"      icon="🔄" />
            <NavLink href="/admin/users"   label="Users"              icon="👥" />
            <NavLink href="/admin/vendors" label="Vendors & Packages" icon="📦" />
          </>
        )}

        {/* Dev section */}
        {dev && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Dev</p>
            </div>
            <NavLink href="/developer" label="Developer Tools" icon="🛠️" />
            <NavLink href="/developer/doc-requests" label="Doc Request Email" icon="📧" />
          </>
        )}

        {/* User Guide — universal */}
        <div className="mt-4 border-t border-slate-100 pt-2">
          <NavLink href="/help" label="User Guide" icon="📖" />
        </div>

      </nav>
    </aside>
  )
}
