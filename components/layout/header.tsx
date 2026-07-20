import type { UserRole } from '@/lib/types/database'
import { GuideButton } from '@/components/guide-button'
import { BackButton } from '@/components/layout/back-button'

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
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm flex-shrink-0">
      <div className="flex h-[var(--header-h)] w-full items-center justify-between gap-4 px-6">
        {/* Brand — back-one-level arrow, then the CoreFlow mark linking back to the platform launcher */}
        <div className="flex h-full shrink-0 items-center gap-3">
        <BackButton />
        <a href={COREFLOW_URL} title="Back to Coreflow" className="flex h-full shrink-0 items-center gap-3 transition-opacity hover:opacity-80">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/coreflow/logo/coreflow-logo-header-crop.png"
            alt="Coreflow"
            className="h-full w-auto shrink-0 object-contain"
          />
          <span className="hidden sm:block text-slate-300 text-lg font-thin">|</span>
          <div className="hidden sm:flex flex-col leading-tight">
            <span className="text-xs font-semibold text-[#0B3563] tracking-wide uppercase">CoreDocs</span>
            <span className="text-xs text-slate-500">PPE Tech</span>
          </div>
        </a>
        </div>

        {/* User */}
        <div className="flex h-full shrink-0 items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/coreflow/logo/ppe-logo.png" alt="PPE Technologies" className="hidden h-full w-auto shrink-0 object-contain sm:block" />
          <GuideButton />
          <div className="hidden sm:flex flex-col items-end gap-0.5">
            <span className="text-sm font-medium text-[#0B3563] leading-tight">{userName}</span>
            <span className="text-xs text-slate-500 capitalize leading-tight">{role.replace('_', ' ')}</span>
          </div>
          <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
          <form action="/auth/signout" method="POST">
            <button type="submit" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
