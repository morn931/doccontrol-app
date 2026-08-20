'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Check, X, Loader2 } from 'lucide-react'
import { respondRouting } from './routing-actions'
import type { RoutedItem } from '@/lib/routing'

// One incoming routing in the "Routed to you" panel — open it, mark it done, or dismiss.
export default function RoutedRow({ item }: { item: RoutedItem }) {
  const [busy, setBusy] = useState<'' | 'done' | 'dismissed'>('')
  const [gone, setGone] = useState(false)
  const router = useRouter()

  async function respond(status: 'done' | 'dismissed') {
    if (busy) return
    setBusy(status)
    const r = await respondRouting(item.id, status)
    if (r.ok) { setGone(true); setTimeout(() => router.refresh(), 250) }
    else { setBusy(''); alert(r.error ?? 'Could not update') }
  }

  if (gone) return null
  const title = item.documentNumber ?? (item.batchId ? 'Batch routed to you' : 'Document routed to you')

  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
        {(item.fromName ?? item.fromEmail).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm font-semibold text-slate-800">{title}</span>
          {item.packageCode && <span className="shrink-0 rounded bg-slate-100 px-1.5 text-xs text-slate-500">{item.packageCode}</span>}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          from <b className="text-slate-700">{item.fromName ?? item.fromEmail}</b>
          {item.note ? <> · &ldquo;{item.note}&rdquo;</> : null}
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          {item.firstTaskId && (
            <Link href={`/reviews/${item.firstTaskId}`} className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900">
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          <button type="button" onClick={() => respond('done')} disabled={!!busy}
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-50">
            {busy === 'done' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Done
          </button>
          <button type="button" onClick={() => respond('dismissed')} disabled={!!busy}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600 disabled:opacity-50">
            {busy === 'dismissed' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
