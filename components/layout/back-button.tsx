'use client'

import { usePathname, useRouter } from 'next/navigation'

const HOME = '/dashboard'

/**
 * Small round "back one level" arrow, shown beside the Coreflow logo on every
 * page except the app home (/dashboard). Steps back one level in the drill-down.
 */
export function BackButton() {
  const pathname = usePathname()
  const router = useRouter()

  if (pathname === HOME) return null

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(HOME)
    }
  }

  return (
    <button
      onClick={goBack}
      title="Back one level"
      aria-label="Back one level"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-teal-400 hover:text-teal-600"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  )
}
