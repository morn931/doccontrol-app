'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { isEmail } from '@/lib/utils/emails'

export type EmailEntry = { email: string; name: string }

// Shared company directory fetch — one request per page load, cached across pickers.
let dirPromise: Promise<EmailEntry[]> | null = null
function loadDirectory(): Promise<EmailEntry[]> {
  if (!dirPromise) {
    dirPromise = fetch('/api/company-emails')
      .then((r) => (r.ok ? r.json() : { emails: [] }))
      .then((d) => (d.emails ?? []) as EmailEntry[])
      .catch(() => [])
  }
  return dirPromise
}

/**
 * A combobox for picking @ppetech.co.za addresses from the company directory, with
 * manual entry of any full email. `multiple` (default true) keeps a removable chip list;
 * single mode holds one address. Selected values are {email,name}.
 */
export default function EmailPicker({ value, onChange, multiple = true, placeholder }: {
  value: EmailEntry[]
  onChange: (v: EmailEntry[]) => void
  multiple?: boolean
  placeholder?: string
}) {
  const [dir, setDir] = useState<EmailEntry[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadDirectory().then(setDir) }, [])

  // Resolve nicer names for already-selected chips once the directory arrives.
  useEffect(() => {
    if (!dir.length || !value.length) return
    let changed = false
    const next = value.map((v) => {
      if (v.name && v.name !== v.email) return v
      const hit = dir.find((d) => d.email.toLowerCase() === v.email.toLowerCase())
      if (hit) { changed = true; return { email: v.email, name: hit.name } }
      return v
    })
    if (changed) onChange(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir])

  const selectedKeys = useMemo(() => new Set(value.map((v) => v.email.toLowerCase())), [value])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dir
      .filter((d) => !selectedKeys.has(d.email.toLowerCase()))
      .filter((d) => !q || d.email.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))
      .slice(0, 50)
  }, [dir, query, selectedKeys])

  const add = (entry: EmailEntry) => {
    const e = entry.email.trim()
    if (!e || selectedKeys.has(e.toLowerCase())) { setQuery(''); return }
    onChange(multiple ? [...value, { email: e, name: entry.name.trim() || e }] : [{ email: e, name: entry.name.trim() || e }])
    setQuery('')
    if (!multiple) setOpen(false)
  }
  const remove = (email: string) => onChange(value.filter((v) => v.email.toLowerCase() !== email.toLowerCase()))

  const canManualAdd = isEmail(query) && !selectedKeys.has(query.trim().toLowerCase()) &&
    !matches.some((m) => m.email.toLowerCase() === query.trim().toLowerCase())

  return (
    <div ref={boxRef} className="relative"
      onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v.email} className="flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-xs text-teal-800">
              {v.name}
              <button type="button" onClick={() => remove(v.email)} className="text-teal-500 hover:text-rose-600" title="Remove">✕</button>
            </span>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && canManualAdd) { e.preventDefault(); add({ email: query, name: query }) } }}
        placeholder={placeholder ?? 'Search company emails or type one…'}
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
      />

      {open && (matches.length > 0 || canManualAdd || query) && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {canManualAdd && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add({ email: query, name: query })}
              className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs text-teal-700 hover:bg-teal-50">
              <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold">Add</span>
              “{query.trim()}” (not in directory)
            </button>
          )}
          {matches.map((m) => (
            <button key={m.email} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(m)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-teal-50">
              <span className="font-medium text-slate-700">{m.name}</span>
              <span className="text-slate-400">{m.email}</span>
            </button>
          ))}
          {matches.length === 0 && !canManualAdd && query && (
            <p className="px-3 py-2 text-xs text-slate-400">
              {query.includes('@') ? 'Already added.' : 'No match — type a full email to add it.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
