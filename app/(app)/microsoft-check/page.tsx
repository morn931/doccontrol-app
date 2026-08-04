'use client'
import { useState } from 'react'
import { acquireGraphToken, signOutMs, EDIT_SCOPES, BASIC_SCOPES } from '@/lib/msal'
import { CheckCircle2, XCircle, Loader2, LogIn, LogOut } from 'lucide-react'

export default function MicrosoftCheckPage() {
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState<any>(null)
  const [signInMsg, setSignInMsg] = useState('')
  const [editState, setEditState] = useState<'idle' | 'ok' | 'consent' | 'err'>('idle')
  const [editMsg, setEditMsg] = useState('')

  async function connect() {
    setBusy(true); setSignInMsg(''); setMe(null)
    try {
      const { token, account } = await acquireGraphToken(BASIC_SCOPES)
      const r = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${token}` } })
      const data = await r.json()
      setMe({ name: data.displayName, upn: data.userPrincipalName, account: account.username })
      setSignInMsg('Signed in — the app registration and sign-in flow work.')
    } catch (e: any) {
      setSignInMsg('Sign-in failed: ' + (e?.errorCode || e?.message || String(e)))
    } finally { setBusy(false) }
  }

  async function testEdit() {
    setBusy(true); setEditState('idle'); setEditMsg('')
    try {
      await acquireGraphToken(EDIT_SCOPES)
      setEditState('ok'); setEditMsg('Admin consent is in place — editing can be turned on.')
    } catch (e: any) {
      const code = e?.errorCode || e?.message || String(e)
      if (/consent|AADSTS65001|interaction_required|approval/i.test(code)) {
        setEditState('consent'); setEditMsg('Awaiting admin consent for Files.ReadWrite.All / Sites.ReadWrite.All (expected until IT grants it).')
      } else { setEditState('err'); setEditMsg('Error: ' + code) }
    } finally { setBusy(false) }
  }

  async function disconnect() { await signOutMs(); setMe(null); setSignInMsg(''); setEditState('idle'); setEditMsg('') }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Microsoft sign-in check</h1>
      <p className="text-sm text-slate-500">
        Diagnostic for the in-window Word/Excel editing feature. Step 1 proves the new
        <b> CoreDocs Editor</b> app registration + sign-in work (no admin consent needed).
        Step 2 shows whether the edit permissions have been granted yet.
      </p>

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold text-slate-900">1 · Sign in (User.Read)</h2>
        <div className="flex gap-2">
          <button onClick={connect} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Connect Microsoft
          </button>
          {me && <button onClick={disconnect} className="btn-secondary"><LogOut className="h-4 w-4" /> Disconnect</button>}
        </div>
        {me && (
          <div className="text-sm bg-emerald-50 border border-emerald-100 rounded p-3 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div><b>{me.name}</b> — {me.upn}</div>
          </div>
        )}
        {signInMsg && !me && <p className="text-sm text-red-600">{signInMsg}</p>}
        {me && <p className="text-xs text-emerald-700">{signInMsg}</p>}
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold text-slate-900">2 · Edit permissions (admin consent)</h2>
        <button onClick={testEdit} disabled={busy || !me} className="btn-secondary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Check edit permissions
        </button>
        {!me && <p className="text-xs text-slate-400">Sign in first.</p>}
        {editState === 'ok' && <p className="text-sm text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> {editMsg}</p>}
        {editState === 'consent' && <p className="text-sm text-amber-700 flex items-center gap-1.5"><XCircle className="h-4 w-4" /> {editMsg}</p>}
        {editState === 'err' && <p className="text-sm text-red-600">{editMsg}</p>}
      </div>
    </div>
  )
}
