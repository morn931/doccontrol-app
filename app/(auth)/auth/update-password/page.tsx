'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function UpdatePasswordPage() {
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)
  const [success, setSuccess]         = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false) }
    else { setSuccess(true); setTimeout(() => router.push('/dashboard'), 2000) }
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-navy-700 rounded-xl mb-4">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">PPE Tech</h1>
          <p className="text-navy-300 text-sm mt-1">Document Control Platform</p>
        </div>

        <div className="bg-white rounded-xl shadow-xl p-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Set your password</h2>
          <p className="text-sm text-slate-500 mb-6">Choose a password to secure your account.</p>

          {success ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-md text-sm text-green-700 text-center">
              ✓ Password set successfully. Redirecting to dashboard…
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>
              )}
              <form onSubmit={handleUpdate} className="space-y-4">
                <div>
                  <label className="label">New password</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                    className="input" placeholder="Min. 8 characters" autoComplete="new-password" />
                </div>
                <div>
                  <label className="label">Confirm password</label>
                  <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
                    className="input" placeholder="Repeat password" autoComplete="new-password" />
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                  {loading ? 'Saving…' : 'Set Password & Sign In'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
