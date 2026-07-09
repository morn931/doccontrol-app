'use client'

import { useState, useTransition } from 'react'
import { setControllerEmail } from '../../documents/requests/actions'

export default function SettingsForm({ current }: { current: string }) {
  const [email, setEmail] = useState(current)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const save = () => {
    setMsg(null)
    start(async () => {
      const r = await setControllerEmail(email)
      setMsg(r.ok ? { ok: true, text: 'Saved ✓' } : { ok: false, text: r.error ?? 'Could not save' })
    })
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">
        Document Controller email (requests are sent here)
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="mornec@ppetech.co.za"
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={pending}
          className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
