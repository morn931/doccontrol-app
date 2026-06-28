'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { UserRole } from '@/lib/types/database'

interface NavItem {
  href:  string
  label: string
  icon:  string
  roles: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',     label: 'Dashboard',          icon: '🏠', roles: ['admin','document_controller','reviewer','engineering_manager','project_manager','vendor'] },
  { href: '/batches',       label: 'Incoming Batches',   icon: '📥', roles: ['admin','document_controller'] },
  { href: '/reviews',       label: 'My Reviews',         icon: '✅', roles: ['admin','document_controller','reviewer','engineering_manager'] },
  { href: '/transmittals',  label: 'Transmittals',       icon: '📤', roles: ['admin','document_controller','project_manager'] },
  { href: '/documents',     label: 'Document Search',    icon: '🔍', roles: ['admin','document_controller','reviewer','engineering_manager','project_manager','vendor'] },
  { href: '/mddr',          label: 'MDDR',               icon: '📋', roles: ['admin','document_controller','engineering_manager','project_manager'] },
  { href: '/reporting',     label: 'Reporting',          icon: '📊', roles: ['admin','document_controller','engineering_manager','project_manager'] },
]

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/import',  label: 'Import & Sync',      icon: '🔄', roles: ['admin'] },
  { href: '/admin/users',   label: 'Users',              icon: '👥', roles: ['admin'] },
  { href: '/admin/vendors', label: 'Vendors & Packages', icon: '📦', roles: ['admin'] },
]

// Always-visible link to the full user manual (mirrors CoreTime's "User Guide" nav item).
const HELP_ITEM: NavItem = {
  href: '/help', label: 'User Guide', icon: '📖',
  roles: ['admin','document_controller','reviewer','engineering_manager','project_manager','vendor','developer'],
}

const DEV_ITEM: NavItem = {
  href: '/developer', label: 'Developer Tools', icon: '🛠️',
  roles: ['developer'],
}

interface SidebarProps { role: UserRole }

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()

  function NavLink({ item }: { item: NavItem }) {
    if (!item.roles.includes(role)) return null
    const active = pathname === item.href || pathname.startsWith(item.href + '/')
    const cls = `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? 'bg-teal-50 text-teal-700'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`
    return (
      <Link href={item.href} className={cls}>
        <span className="text-base">{item.icon}</span>
        {item.label}
      </Link>
    )
  }

  return (
    <aside className="hidden md:flex w-52 bg-white border-r border-slate-200 flex-col py-4 px-3 flex-shrink-0">
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(item => <NavLink key={item.href} item={item} />)}

        {role === 'admin' && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Admin</p>
            </div>
            {ADMIN_ITEMS.map(item => <NavLink key={item.href} item={item} />)}
          </>
        )}

        {role === 'developer' && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Dev</p>
            </div>
            <NavLink item={DEV_ITEM} />
          </>
        )}

        <div className="mt-4 border-t border-slate-100 pt-2">
          <NavLink item={HELP_ITEM} />
        </div>
      </nav>
    </aside>
  )
}
