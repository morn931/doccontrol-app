'use client'

import { useState, useTransition } from 'react'
import { setControllerEmail } from '../../documents/requests/actions'
import EmailPicker, { type EmailEntry } from '@/components/email-picker'
import { splitEmails } from '@/lib/utils/emails'

export default function SettingsForm({ current }: { current: string }) {
  const [emails, setEmails] = useState<EmailEntry[]>(splitEmails(current).map((e) => ({ email: e, name: e })))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const save = () => {
    setMsg(null)
    start(async () => {
      const joined = emails.map((e) => e.email).join('; ')
      const r = await setControllerEmail(joined)
      setMsg(r.ok ? { ok: true, text: 'Saved ✓' } : { ok: false, text: r.error ?? 'Could not save' })
    })
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">
        Document Controller email(s) — requests are sent to everyone listed
      </label>
      <div className="mt-1">
        <EmailPicker value={emails} onChange={(v) => { setMsg(null); setEmails(v) }} placeholder="Add a Document Controller email…" />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">Pick from the company directory or type any full email. Add more than one to notify several people.</p>
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
