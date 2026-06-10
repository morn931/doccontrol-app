'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import {
  LayoutDashboard, Inbox, ClipboardCheck,
  Send, Search, Settings, LogOut, Shield, Users, Upload, ListChecks, BarChart3,
} from 'lucide-react'
import type { UserRole } from '@/lib/types/database'

interface NavItem {
  href:  string
  label: string
  icon:  React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',     label: 'Dashboard',         icon: LayoutDashboard, roles: ['admin','document_controller','reviewer','engineering_manager','project_manager','vendor'] },
  { href: '/batches',       label: 'Incoming Batches',  icon: Inbox,           roles: ['admin','document_controller'] },
  { href: '/reviews',       label: 'My Reviews',        icon: ClipboardCheck,  roles: ['admin','document_controller','reviewer','engineering_manager'] },
  { href: '/transmittals',  label: 'Transmittals',      icon: Send,            roles: ['admin','document_controller','project_manager'] },
  { href: '/documents',     label: 'Document Search',   icon: Search,          roles: ['admin','document_controller','reviewer','engineering_manager','project_manager','vendor'] },
  { href: '/mddr',          label: 'MDDR',              icon: ListChecks,      roles: ['admin','document_controller','engineering_manager','project_manager'] },
  { href: '/reporting',     label: 'Reporting',         icon: BarChart3,       roles: ['admin','document_controller','engineering_manager','project_manager'] },
]

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/import',  label: 'Import & Sync',     icon: Upload,          roles: ['admin'] },
  { href: '/admin/users',   label: 'Users',             icon: Users,           roles: ['admin'] },
  { href: '/admin/vendors', label: 'Vendors & Packages', icon: Shield,         roles: ['admin'] },
]

interface SidebarProps { role: UserRole; userEmail: string; userName: string }

export function Sidebar({ role, userEmail, userName }: SidebarProps) {
  const pathname = usePathname()

  function NavLink({ item }: { item: NavItem }) {
    if (!item.roles.includes(role)) return null
    const active = pathname === item.href || pathname.startsWith(item.href + '/')
    return (
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          active
            ? 'bg-navy-700 text-white'
            : 'text-navy-200 hover:bg-navy-800 hover:text-white'
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {item.label}
      </Link>
    )
  }

  return (
    <aside className="flex flex-col w-64 bg-navy-900 min-h-screen shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-navy-800">
        <div className="flex items-center justify-center bg-white rounded-lg shrink-0 px-1.5 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/coreflow-mark.png" alt="Coreflow" className="h-5 w-auto" />
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-tight">PPE Tech</p>
          <p className="text-navy-400 text-xs">Document Control</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => <NavLink key={item.href} item={item} />)}

        {role === 'admin' && (
          <>
            <div className="pt-4 pb-1 px-3">
              <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider">Admin</p>
            </div>
            {ADMIN_ITEMS.map(item => <NavLink key={item.href} item={item} />)}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t border-navy-800 space-y-1">
        <div className="px-3 py-2">
          <p className="text-sm font-medium text-white truncate">{userName}</p>
          <p className="text-xs text-navy-400 truncate">{userEmail}</p>
          <span className="inline-block mt-1 px-2 py-0.5 bg-navy-700 text-navy-200 rounded text-xs capitalize">
            {role.replace('_', ' ')}
          </span>
        </div>
        <form action="/auth/signout" method="POST">
          <button type="submit"
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-navy-300 hover:bg-navy-800 hover:text-white transition-colors">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
