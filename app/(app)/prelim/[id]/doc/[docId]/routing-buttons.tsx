'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, UserCheck, CheckCircle2, Undo2 } from 'lucide-react'

export type Routing = 'drawing_office' | 'lead' | 'ready_for_tender'
type Person = { email: string; name: string; role: string }

const LABEL: Record<Routing, string> = { drawing_office: 'To drawing office', lead: 'To Lead', ready_for_tender: 'Ready for tender' }

// The three calls a reviewer makes on a drawing in the tender push — see migration 053.
// One call per drawing: after it is made, the chosen one stays lit and all three lock.
export default function RoutingButtons({ docId, routing, routingTo, routingToEmail, routingAt, routingBy, mailedAt, attached, error, open, canManage, tenderCopyUrl, tenderCopyName, tenderStampError }: {
  docId: string; routing: Routing | null; routingTo: string | null; routingToEmail: string | null; routingAt: string | null; routingBy: string | null
  mailedAt: string | null; attached: boolean | null; error: string | null; open: boolean; canManage: boolean
  tenderCopyUrl?: string | null; tenderCopyName?: string | null; tenderStampError?: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<Routing | 'undo' | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [pick, setPick] = useState<{ reason: string; owner: string | null; candidates: Person[]; people: Person[] } | null>(null)
  const [chosen, setChosen] = useState('')
  const [free, setFree] = useState('')

  const locked = !!routing || !open

  async function send(action: Routing, toEmail?: string) {
    if (!toEmail) {
      const ask = action === 'drawing_office' ? 'Send this marked-up drawing to the drawing office?'
                : action === 'lead' ? 'Send this marked-up drawing to its PPE responsible person?'
                : 'Mark this drawing ready for tender? A copy stamped "ISSUED FOR TENDER ONLY" on every page is filed beside the source in COLAB. No mail is sent.'
      if (!confirm(ask)) return
    }
    setBusy(action); setErr(''); setMsg('')
    try {
      const res = await fetch(`/api/prelim/documents/${docId}/routing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, toEmail: toEmail || undefined }) })
      const d = await res.json()
      if (res.status === 409 && d.needLead) { setPick({ reason: d.reason, owner: d.owner, candidates: d.candidates ?? [], people: d.people ?? [] }); setChosen(d.candidates?.[0]?.email ?? ''); return }
      if (!res.ok) { setErr(d.error ?? 'Could not record the call.'); router.refresh(); return }
      setPick(null)
      setMsg(action === 'ready_for_tender' ? `Marked ready for tender${d.tenderCopy ? ` — stamped copy filed (${d.tenderCopy.pages} page${d.tenderCopy.pages === 1 ? '' : 's'}).` : '.'}` : `Sent to ${d.to?.name ?? d.to?.email}${d.attached ? ' with the PDF attached.' : d.sizeMb ? ` — the PDF (${d.sizeMb} MB) was too large to attach, so the mail carries a link to it.` : '.'}`)
      router.refresh()
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }
  async function undo() {
    if (!confirm('Undo this call so the three buttons unlock? The mail already sent is not recalled.')) return
    setBusy('undo'); setErr(''); setMsg('')
    try {
      const res = await fetch(`/api/prelim/documents/${docId}/routing`, { method: 'DELETE' })
      const d = await res.json(); if (!res.ok) { setErr(d.error ?? 'Could not undo.'); return }
      setMsg('Unlocked.'); router.refresh()
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }

  const btn = (action: Routing, Icon: any, lit: string) => {
    const isThis = routing === action
    const cls = isThis ? `${lit} ring-2 ring-offset-1` : locked ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
    return (
      <button type="button" disabled={locked || busy !== null} onClick={() => send(action)}
        title={isThis ? 'The call made on this drawing' : locked ? (routing ? 'A call has already been made on this drawing' : 'Session closed') : undefined}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition ${cls}`}>
        {busy === action ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />} {LABEL[action]}
      </button>
    )
  }
  const when = (s: string | null) => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 mr-1">Before tender</span>
        {btn('drawing_office', Mail, 'border-sky-600 bg-sky-600 text-white ring-sky-300')}
        {btn('lead', UserCheck, 'border-amber-500 bg-amber-500 text-white ring-amber-300')}
        {btn('ready_for_tender', CheckCircle2, 'border-emerald-600 bg-emerald-600 text-white ring-emerald-300')}
        {routing && (
          <span className="text-xs text-slate-600 ml-1">
            {routing === 'ready_for_tender' ? 'Marked ready for tender' : `${mailedAt ? 'Sent' : 'Recorded, mail failed'} to ${routingTo ?? routingToEmail}${mailedAt ? (attached === false ? ' (link, PDF too large)' : ' with the PDF') : ''}`}
            {' '}· {routingBy} · {when(routingAt)}
            {routing === 'ready_for_tender' && tenderCopyUrl && <> · <a href={tenderCopyUrl} target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 hover:underline" title={tenderCopyName ?? undefined}>Stamped tender copy ↗</a> <span className="text-slate-400">(every page: ISSUED FOR TENDER ONLY, filed beside the source in COLAB)</span></>}
            {routing === 'ready_for_tender' && tenderStampError && <span className="text-red-600"> · stamped copy failed: {tenderStampError}</span>}
            {error && <span className="text-red-600"> · {error}</span>}
          </span>
        )}
        {routing && canManage && open && (
          <button type="button" onClick={undo} disabled={busy !== null} className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            {busy === 'undo' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Undo
          </button>
        )}
      </div>
      {(msg || err) && <p className={`mt-2 text-xs ${err ? 'text-red-600' : 'text-emerald-700'}`}>{err || msg}</p>}

      {pick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPick(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900">Who is the lead for this drawing?</h3>
            <p className="text-sm text-slate-600">{pick.reason}</p>
            <label className="block text-xs font-medium text-slate-600">Choose a person
              <select className="input mt-1" value={chosen} onChange={e => { setChosen(e.target.value); setFree('') }}>
                <option value="">—</option>
                {pick.candidates.length > 0 && <optgroup label="Named on the CDDL">{pick.candidates.map(p => <option key={p.email} value={p.email}>{p.name} — {p.email}</option>)}</optgroup>}
                <optgroup label="Everyone in CoreDocs">{pick.people.filter(p => !pick.candidates.some(c => c.email === p.email)).map(p => <option key={p.email} value={p.email}>{p.name} — {p.email}</option>)}</optgroup>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">…or type an email address
              <input className="input mt-1" placeholder="name@ppetech.co.za" value={free} onChange={e => { setFree(e.target.value); setChosen('') }} />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary text-xs" onClick={() => setPick(null)}>Cancel</button>
              <button type="button" className="btn-primary text-xs" disabled={busy !== null || !(chosen || free.includes('@'))} onClick={() => send('lead', chosen || free.trim())}>
                {busy === 'lead' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Send to lead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
