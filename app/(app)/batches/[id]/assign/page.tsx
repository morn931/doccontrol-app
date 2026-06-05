'use client'
import { useState, useEffect, use } from 'react'
import { ArrowLeft, Plus, X, GripVertical, Users, Sparkles, ChevronUp, ChevronDown, Send } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Reviewer {
  email:       string
  name:        string
  sequenceNumber: number
}

export default function AssignReviewersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [batch, setBatch]           = useState<any>(null)
  const [reviewers, setReviewers]   = useState<Reviewer[]>([])
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [allUsers, setAllUsers]     = useState<any[]>([])
  const [dueDate, setDueDate]       = useState('')
  const [instructions, setInstructions] = useState('')
  const [emailSearch, setEmailSearch] = useState('')
  const [loading, setLoading]       = useState(true)
  const [starting, setStarting]     = useState(false)
  const [error, setError]           = useState('')
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    const [batchRes, suggestRes] = await Promise.all([
      fetch(`/api/batches/${id}`),
      fetch(`/api/reviewer-suggestions`),
    ])
    if (batchRes.ok) {
      const b = await batchRes.json()
      setBatch(b)
      // Fetch suggestions with package context
      const pkgId = b.packages?.id
      if (pkgId) {
        const sr = await fetch(`/api/reviewer-suggestions?packageId=${pkgId}`)
        if (sr.ok) { const s = await sr.json(); setSuggestions(s.suggestions); setAllUsers(s.users) }
      }
    }
    if (suggestRes.ok) {
      const s = await suggestRes.json()
      if (!allUsers.length) { setSuggestions(s.suggestions); setAllUsers(s.users) }
    }
    setLoading(false)
  }

  function addReviewer(email: string, name: string) {
    if (reviewers.find(r => r.email === email)) return
    const nextSeq = reviewers.length > 0 ? Math.max(...reviewers.map(r => r.sequenceNumber)) + 1 : 1
    setReviewers([...reviewers, { email, name, sequenceNumber: nextSeq }])
    setShowPicker(false)
    setEmailSearch('')
  }

  function removeReviewer(email: string) {
    const updated = reviewers.filter(r => r.email !== email)
    // Renumber sequences
    setReviewers(updated.map((r, i) => ({ ...r, sequenceNumber: i + 1 })))
  }

  function moveUp(index: number) {
    if (index === 0) return
    const updated = [...reviewers]
    ;[updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]
    setReviewers(updated.map((r, i) => ({ ...r, sequenceNumber: i + 1 })))
  }

  function moveDown(index: number) {
    if (index === reviewers.length - 1) return
    const updated = [...reviewers]
    ;[updated[index], updated[index + 1]] = [updated[index + 1], updated[index]]
    setReviewers(updated.map((r, i) => ({ ...r, sequenceNumber: i + 1 })))
  }

  function addSuggestion(s: any) {
    addReviewer(s.email, s.name)
  }

  async function handleStartReview() {
    if (!reviewers.length) { setError('Add at least one reviewer'); return }
    setError(''); setStarting(true)
    const res = await fetch(`/api/batches/${id}/start-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewers, dueDate: dueDate || null, instructions }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to start review'); setStarting(false) }
    else { router.push(`/batches/${id}`) }
  }

  const filteredUsers = allUsers.filter(u =>
    !reviewers.find(r => r.email === u.email) &&
    (u.email.toLowerCase().includes(emailSearch.toLowerCase()) ||
     (u.full_name ?? '').toLowerCase().includes(emailSearch.toLowerCase()))
  )

  const unusedSuggestions = suggestions.filter(s => !reviewers.find(r => r.email === s.email))

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-700" />
    </div>
  )

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href={`/batches/${id}`} className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Assign Reviewers</h1>
        <p className="text-gray-500 text-sm mt-1">
          {batch?.packages?.package_name ?? 'Unknown Package'} — {batch?.document_versions?.length ?? 0} document{(batch?.document_versions?.length ?? 0) !== 1 ? 's' : ''}
        </p>
      </div>

      {/* AI Suggestions */}
      {unusedSuggestions.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-navy-500" />
            <h2 className="font-semibold text-gray-900 text-sm">Suggested Reviewers</h2>
            <span className="text-xs text-gray-400">Based on historical review patterns for this package</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {unusedSuggestions.slice(0, 6).map(s => (
              <button key={s.email} onClick={() => addSuggestion(s)}
                className="flex items-center gap-2 px-3 py-1.5 bg-navy-50 border border-navy-200 rounded-full text-sm text-navy-700 hover:bg-navy-100 transition-colors">
                <Plus className="h-3.5 w-3.5" />
                {s.name}
                <span className="text-xs text-navy-400">({s.reviewCount} reviews)</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Reviewer sequence */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-500" />
            <h2 className="font-semibold text-gray-900">Review Sequence ({reviewers.length})</h2>
          </div>
          <button onClick={() => setShowPicker(!showPicker)} className="btn-secondary text-xs py-1.5 px-3">
            <Plus className="h-3.5 w-3.5" /> Add Reviewer
          </button>
        </div>

        {/* Reviewer picker */}
        {showPicker && (
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            <input
              type="text" value={emailSearch}
              onChange={e => setEmailSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="input mb-3" autoFocus
            />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {/* Allow adding any email address directly even if not in users table */}
              {filteredUsers.length === 0 && emailSearch.includes('@') && (
                <button onClick={() => addReviewer(emailSearch.trim(), emailSearch.trim())}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-navy-50 text-left transition-colors border border-dashed border-navy-300">
                  <div className="w-8 h-8 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-semibold text-sm shrink-0">+</div>
                  <div>
                    <p className="text-sm font-medium text-navy-700">Add "{emailSearch.trim()}"</p>
                    <p className="text-xs text-gray-400">Not in user list — add directly by email</p>
                  </div>
                </button>
              )}
              {filteredUsers.length === 0 && !emailSearch.includes('@') && emailSearch && (
                <p className="text-sm text-gray-400 py-2">No users found. Type a full email address to add directly.</p>
              )}
              {filteredUsers.map(u => (
                <button key={u.email} onClick={() => addReviewer(u.email, u.full_name ?? u.email)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white text-left transition-colors">
                  <div className="w-8 h-8 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-semibold text-sm shrink-0">
                    {(u.full_name ?? u.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{u.full_name ?? u.email}</p>
                    <p className="text-xs text-gray-400">{u.email} · {u.role}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="divide-y divide-gray-50">
          {reviewers.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-400">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No reviewers added yet. Use suggestions above or click Add Reviewer.</p>
            </div>
          ) : reviewers.map((r, i) => (
            <div key={r.email} className="px-6 py-4 flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-navy-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                {r.sequenceNumber}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-900">{r.name}</p>
                <p className="text-xs text-gray-400">{r.email}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => moveUp(i)} disabled={i === 0}
                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button onClick={() => moveDown(i)} disabled={i === reviewers.length - 1}
                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button onClick={() => removeReviewer(r.email)}
                  className="p-1 text-gray-400 hover:text-red-500 ml-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Settings */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Review Settings</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Due Date (optional)</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input" />
          </div>
        </div>
        <div>
          <label className="label">Instructions for Reviewers (optional)</label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            rows={3} className="input resize-none"
            placeholder="e.g. Please review the attached ABB documents and provide your technical comments…"
          />
        </div>
      </div>

      {error && <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

      <div className="flex gap-3">
        <button onClick={handleStartReview} disabled={starting || !reviewers.length}
          className="btn-primary flex-1 justify-center py-3 text-base">
          <Send className="h-5 w-5" />
          {starting ? 'Starting Review…' : `Start Review — Notify ${reviewers[0]?.name ?? 'First Reviewer'}`}
        </button>
        <Link href={`/batches/${id}`} className="btn-secondary px-6">Cancel</Link>
      </div>

      <p className="text-xs text-gray-400 text-center">
        Reviewers will receive email notifications one at a time in the order shown above.
        The first reviewer ({reviewers[0]?.name ?? '—'}) will be notified immediately.
      </p>
    </div>
  )
}
