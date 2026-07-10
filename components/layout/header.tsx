import type { UserRole } from '@/lib/types/database'
import { GuideButton } from '@/components/guide-button'

const COREFLOW_URL = process.env.NEXT_PUBLIC_COREFLOW_URL || 'https://coreflow.build'

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
    <header className="bg-[#02335E] bg-cover bg-center bg-no-repeat border-b border-slate-200 flex-shrink-0 sm:bg-[url('/coreflow/header/backgrounds/hero-industrial-desktop-1920w.png')] max-sm:bg-[url('/coreflow/header/backgrounds/hero-industrial-mobile-780x1040@2x.png')] max-sm:bg-bottom">
      <div className="px-4 sm:px-6">
        <div className="flex h-14 items-center justify-between">
          {/* Brand — the CoreFlow mark links back to the platform launcher */}
          <div className="flex items-center gap-3">
            <a href={COREFLOW_URL} title="Back to Coreflow" className="flex-shrink-0 transition-opacity hover:opacity-80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/coreflow/logo/coreflow-logo-white.png"
                alt="Coreflow"
                className="h-9 w-auto object-contain"
              />
            </a>
            <span className="hidden sm:block text-white/30 text-lg font-thin">|</span>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-xs font-semibold text-white tracking-wide uppercase">CoreDocs</span>
              <span className="text-xs text-white/60">PPE Tech</span>
            </div>
          </div>

          {/* User */}
          <div className="flex items-center gap-4">
            <GuideButton />
            <div className="hidden sm:flex flex-col items-end gap-0.5">
              <span className="text-sm font-medium text-white leading-tight">{userName}</span>
              <span className="text-xs text-white/60 capitalize leading-tight">{role.replace('_', ' ')}</span>
            </div>
            <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold">
              {initials}
            </div>
            <form action="/auth/signout" method="POST">
              <button type="submit" className="text-sm text-white/80 hover:text-white transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  )
}
