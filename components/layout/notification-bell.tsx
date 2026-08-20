'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck, CornerUpRight, ClipboardCheck, ListChecks, MessageSquare } from 'lucide-react'

type Notif = { id: string; type: string; title: string; body: string | null; href: string | null; read: boolean; createdAt: string | null }

// Colour code (Liezl's in-screen notification idea, generalised) — one hue per source.
const TYPE: Record<string, { dot: string; icon: typeof Bell; ring: string }> = {
  routing: { dot: 'bg-violet-500', icon: CornerUpRight, ring: 'text-violet-600' },
  review: { dot: 'bg-teal-500', icon: ClipboardCheck, ring: 'text-teal-600' },
  action: { dot: 'bg-sky-500', icon: ListChecks, ring: 'text-sky-600' },
  message: { dot: 'bg-emerald-500', icon: MessageSquare, ring: 'text-emerald-600' },
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setItems(d.items ?? [])
      setUnread(d.unread ?? 0)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 90_000) // in-screen refresh, no email
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function markAll() {
    setUnread(0); setItems((xs) => xs.map((x) => ({ ...x, read: true })))
    await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) })
  }

  async function openItem(n: Notif) {
    if (!n.read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnread((u) => Math.max(0, u - 1))
      fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [n.id] }) }).catch(() => {})
    }
    setOpen(false)
    if (n.href) router.push(n.href)
  }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Notifications"
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-800">Notifications</span>
            {unread > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">{unread} new</span>}
            <button type="button" onClick={markAll} disabled={unread === 0}
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 disabled:text-slate-300">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-[22rem] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                <Bell className="mx-auto mb-2 h-8 w-8 opacity-25" />
                You&apos;re all caught up.
              </div>
            ) : (
              items.map((n) => {
                const t = TYPE[n.type] ?? { dot: 'bg-slate-400', icon: Bell, ring: 'text-slate-500' }
                const Icon = t.icon
                return (
                  <button key={n.id} type="button" onClick={() => openItem(n)}
                    className={`flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${n.read ? '' : 'bg-slate-50/60'}`}>
                    <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-50 ${t.ring}`}><Icon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {!n.read && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />}
                        <span className={`truncate text-sm ${n.read ? 'font-medium text-slate-600' : 'font-semibold text-slate-900'}`}>{n.title}</span>
                      </span>
                      {n.body && <span className="mt-0.5 block truncate text-xs text-slate-400">{n.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-slate-400">{ago(n.createdAt)}</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
