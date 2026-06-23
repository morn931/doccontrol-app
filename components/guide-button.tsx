'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { guideFor, anchorFor } from '@/lib/guide/registry'

/**
 * Contextual "Guide" button — shows in the header on every CoreDocs page and opens a
 * popup with THAT screen's screenshot + how-to (from lib/guide/registry).
 * Mirrors the CoreTime guide-button.
 */
export function GuideButton() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const entry = guideFor(pathname || '')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!entry) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Guide: ${entry.title}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition-colors"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Guide
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
          onClick={() => setOpen(false)}>
          <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-600">Screen guide</p>
                <h2 className="text-lg font-bold text-slate-900">{entry.title}</h2>
              </div>
              <button onClick={() => setOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-slate-600">{entry.intro}</p>

              {entry.images.map(src => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt={entry.title}
                  className="w-full rounded-lg border border-slate-200 shadow-sm" />
              ))}

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">How to use this screen</p>
                <ul className="space-y-1.5">
                  {entry.tips.map((t, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-700">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
              <a href={`/help#${anchorFor(entry)}`}
                className="text-sm font-medium text-teal-700 hover:underline">
                Open full guide →
              </a>
              <button onClick={() => setOpen(false)}
                className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700">
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
