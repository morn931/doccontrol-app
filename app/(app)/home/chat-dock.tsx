'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MessageSquare, Send, ImagePlus, Loader2, Trash2 } from 'lucide-react'

type Msg = { id: string; author_email: string; author_name: string | null; body: string | null; image_url: string | null; created_at: string }
type Person = { email: string; name: string }

const AV_COLORS = ['#0B3563', '#0e7490', '#7c3aed', '#0e9d54', '#c67c05', '#be185d', '#2563eb']
function colorFor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length] }
function initials(s: string) { return s.split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() }
function timeOf(iso: string) { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

function renderBody(text: string) {
  return text.split(/(@[\w.-]+)/g).map((part, i) =>
    part.startsWith('@')
      ? <span key={i} className="rounded bg-teal-50 px-1 font-semibold text-teal-700">{part}</span>
      : <span key={i}>{part}</span>)
}

// The project-wide live "Engineering Room". Live via Supabase Realtime (+ 20s
// polling backstop), presence, image sharing, @-mention autocomplete, and a
// Clear-history control for the chat admins.
export default function ChatDock({ me, people, canClear }: { me: Person; people: Person[]; canClear: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const [messages, setMessages] = useState<Msg[]>([])
  const [online, setOnline] = useState<Person[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [pending, setPending] = useState(false)
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null)
  const [mIdx, setMIdx] = useState(0)
  const streamRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seen = useRef<Set<string>>(new Set())

  const append = useCallback((m: Msg) => {
    if (!m?.id || seen.current.has(m.id)) return
    seen.current.add(m.id)
    setMessages((xs) => [...xs, m].sort((a, b) => a.created_at.localeCompare(b.created_at)))
  }, [])

  // Authoritative reload — replaces the list, so a Clear (or a delete elsewhere)
  // empties everyone's view within the poll interval.
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/chat', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      const msgs = (d.messages ?? []) as Msg[]
      seen.current = new Set(msgs.map((m) => m.id))
      setMessages(msgs)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const db = supabase.channel('chat-db-engineering')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_message', filter: 'room=eq.engineering' },
        (payload) => append(payload.new as Msg))
      .subscribe()
    const pres = supabase.channel('chat-presence-engineering', { config: { presence: { key: me.email } } })
    pres.on('presence', { event: 'sync' }, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = pres.presenceState() as Record<string, any[]>
      const ppl = Object.values(state).flat().map((p) => ({ email: p.email as string, name: p.name as string }))
      setOnline(Array.from(new Map(ppl.map((p) => [p.email, p])).values()))
    }).subscribe((status) => { if (status === 'SUBSCRIBED') pres.track({ email: me.email, name: me.name }) })
    const t = setInterval(load, 20_000)
    return () => { supabase.removeChannel(db); supabase.removeChannel(pres); clearInterval(t) }
  }, [supabase, me.email, me.name, append, load])

  useEffect(() => { streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }) }, [messages.length])

  // ── @-mention autocomplete ──────────────────────────────────────────────────
  const matches = useMemo(() => {
    if (!mention) return []
    const q = mention.q.toLowerCase()
    const list = q ? people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : people
    return list.slice(0, 6)
  }, [mention, people])

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setInput(val)
    const caret = e.target.selectionStart ?? val.length
    const m = /(^|\s)@([\w.-]*)$/.exec(val.slice(0, caret))
    if (m) { setMention({ q: m[2], start: caret - m[2].length - 1 }); setMIdx(0) }
    else setMention(null)
  }

  function pickMention(p: Person) {
    const first = (p.name.split(' ')[0] || p.email.split('@')[0])
    const caret = inputRef.current?.selectionStart ?? input.length
    const start = mention?.start ?? caret
    const next = input.slice(0, start) + '@' + first + ' ' + input.slice(caret)
    setInput(next); setMention(null)
    const pos = start + first.length + 2
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(pos, pos) })
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMIdx((i) => (i + 1) % matches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMIdx((i) => (i - 1 + matches.length) % matches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(matches[mIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return }
    }
    if (e.key === 'Enter') { e.preventDefault(); send() }
  }

  async function post(body: string, imageUrl?: string) {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, imageUrl }) })
    if (r.status === 503) { setPending(true); return }
    const d = await r.json().catch(() => ({}))
    if (r.ok && d.message) append(d.message as Msg)
    else if (!r.ok) alert(d.error ?? 'Could not send')
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true); setInput(''); setMention(null)
    await post(text)
    setSending(false)
  }

  async function onFile(files: FileList | null) {
    const file = files?.[0]
    if (!file || uploading) return
    setUploading(true)
    try {
      const fd = new FormData(); fd.set('file', file)
      const r = await fetch('/api/chat/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (r.ok && d.url) { const t = input.trim(); setInput(''); await post(t, d.url) }
      else alert(d.error ?? 'Upload failed')
    } catch { alert('Upload failed') }
    setUploading(false)
  }

  async function clearHistory() {
    if (clearing) return
    if (!confirm('Clear ALL messages in the Engineering Room for everyone? This deletes the history and shared images and cannot be undone.')) return
    setClearing(true)
    const r = await fetch('/api/chat/clear', { method: 'POST' })
    setClearing(false)
    if (r.ok) { setMessages([]); seen.current.clear() }
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? 'Could not clear the room') }
  }

  return (
    <section className="card mt-5 overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal-600"><MessageSquare className="h-4 w-4" /></span>
        <h2 className="font-semibold text-slate-900">Engineering Room</h2>
        <span className="text-xs text-slate-400">· project-wide</span>
        {canClear && (
          <button type="button" onClick={clearHistory} disabled={clearing}
            className="ml-3 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Clear history
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex -space-x-2">
            {online.slice(0, 5).map((p) => (
              <span key={p.email} title={p.name} className="grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[9px] font-bold text-white" style={{ background: colorFor(p.email) }}>{initials(p.name || p.email)}</span>
            ))}
          </div>
          {online.length > 0 && <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{online.length} online</span>}
        </div>
      </div>

      <div ref={streamRef} className="flex max-h-80 flex-col gap-3 overflow-y-auto bg-slate-50/60 p-4">
        {messages.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            {pending ? 'Chat is switching on (migration 045 pending).' : 'No messages yet — say hello 👋'}
          </div>
        ) : messages.map((m) => {
          const mine = m.author_email.toLowerCase() === me.email.toLowerCase()
          return (
            <div key={m.id} className={`flex max-w-[80%] gap-2.5 ${mine ? 'ml-auto flex-row-reverse' : ''}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: colorFor(m.author_email) }}>{initials(m.author_name || m.author_email)}</span>
              <div className={mine ? 'text-right' : ''}>
                <div className={`inline-block rounded-2xl px-3 py-2 text-left shadow-sm ${mine ? 'rounded-tr-sm bg-[#0B3563] text-white' : 'rounded-tl-sm border border-slate-200 bg-white text-slate-800'}`}>
                  {!mine && <div className="mb-0.5 text-[11px] font-bold text-slate-500">{m.author_name || m.author_email}</div>}
                  {m.body && <div className="whitespace-pre-wrap break-words text-sm leading-snug">{renderBody(m.body)}</div>}
                  {m.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a href={m.image_url} target="_blank" rel="noreferrer"><img src={m.image_url} alt="" className="mt-1 max-h-52 rounded-lg" /></a>
                  )}
                </div>
                <div className="mt-0.5 px-1 text-[10px] text-slate-400">{timeOf(m.created_at)}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onFile(e.target.files); e.currentTarget.value = '' }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} title="Share an image"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-50">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        </button>
        <div className="relative min-w-0 flex-1">
          {mention && matches.length > 0 && (
            <div className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Mention someone</div>
              {matches.map((p, i) => (
                <button key={p.email} type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(p) }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === mIdx ? 'bg-teal-50 text-teal-800' : 'text-slate-700 hover:bg-slate-50'}`}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: colorFor(p.email) }}>{initials(p.name || p.email)}</span>
                  <span className="min-w-0 truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
          <input ref={inputRef} value={input} onChange={onInput} onKeyDown={onKey}
            placeholder="Message the engineering room…  (type @ to mention)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400" />
        </div>
        <button type="button" onClick={send} disabled={sending || !input.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40">
          <Send className="h-4 w-4" /> Send
        </button>
      </div>
    </section>
  )
}
