import type { UserRole } from '@/lib/types/database'

interface HeaderProps {
  userName: string
  role: UserRole
}

/**
 * Top brand/user header — aligned to CoreTime's shell.
 * Coreflow wordmark + module label on the left; user name, role, initials
 * avatar and sign-out on the right.
 */
export function Header({ userName, role }: HeaderProps) {
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <header className="bg-white border-b border-slate-200 flex-shrink-0">
      <div className="px-4 sm:px-6">
        <div className="flex h-14 items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/coreflow-logo.png"
              alt="Coreflow"
              className="h-9 w-auto object-contain"
            />
            <span className="hidden sm:block text-slate-200 text-lg font-thin">|</span>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-xs font-semibold text-slate-700 tracking-wide uppercase">CoreDocs</span>
              <span className="text-xs text-slate-400">PPE Tech</span>
            </div>
          </div>

          {/* User */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end gap-0.5">
              <span className="text-sm font-medium text-slate-700 leading-tight">{userName}</span>
              <span className="text-xs text-slate-400 capitalize leading-tight">{role.replace('_', ' ')}</span>
            </div>
            <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold">
              {initials}
            </div>
            <form action="/auth/signout" method="POST">
              <button type="submit" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  )
}
