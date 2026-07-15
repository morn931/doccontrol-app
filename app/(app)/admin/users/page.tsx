'use client'
import { useState, useEffect } from 'react'
import { Users, Plus, Edit3, Save, X, CheckCircle } from 'lucide-react'

const ROLES = ['admin','document_controller','engineering_manager','reviewer','project_manager','vendor']

export default function UsersPage() {
  const [users, setUsers]       = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [form, setForm]         = useState({ email:'', full_name:'', role:'reviewer', department:'', discipline:'' })
  const [editForm, setEditForm] = useState<any>({})
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.email || !form.full_name) { setError('Email and name are required'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    setShowAdd(false)
    setForm({ email:'', full_name:'', role:'reviewer', department:'', discipline:'' })
    loadUsers()
    setSaving(false)
  }

  async function handleEdit(userId: string) {
    setSaving(true)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) { setEditId(null); loadUsers() }
    setSaving(false)
  }

  const roleColors: Record<string, string> = {
    admin: 'bg-teal-100 text-teal-700',
    document_controller: 'bg-navy-100 text-navy-700',
    engineering_manager: 'bg-blue-100 text-teal-700',
    reviewer: 'bg-slate-100 text-slate-600',
    project_manager: 'bg-teal-100 text-teal-700',
    vendor: 'bg-amber-100 text-amber-700',
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users &amp; Role Assignment</h1>
          <p className="text-slate-500 text-sm mt-1">Manage CoreDocs users and assign their access role</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">
          <Plus className="h-4 w-4" /> Add User
        </button>
      </div>

      {/* Add user form */}
      {showAdd && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Add New User</h2>
          <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Email address *</label>
              <input value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                type="email" required className="input" placeholder="user@ppetech.co.za" />
            </div>
            <div>
              <label className="label">Full Name *</label>
              <input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
                required className="input" placeholder="John Smith" />
            </div>
            <div>
              <label className="label">Role</label>
              <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="input">
                {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Discipline (optional)</label>
              <input value={form.discipline} onChange={e => setForm({...form, discipline: e.target.value})}
                className="input" placeholder="Electrical, Civil, etc." />
            </div>
            {error && <div className="col-span-2 text-sm text-red-600">{error}</div>}
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Adding…' : 'Add User'}
              </button>
              <button type="button" onClick={() => { setShowAdd(false); setError('') }} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-900">All Users ({users.length})</h2>
        </div>
        {loading ? (
          <div className="py-10 text-center text-slate-400">Loading…</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {users.map(u => (
              <div key={u.id} className="px-6 py-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-bold text-sm shrink-0">
                  {(u.full_name ?? u.email)[0].toUpperCase()}
                </div>
                {editId === u.id ? (
                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <input value={editForm.full_name ?? ''} onChange={e => setEditForm({...editForm, full_name: e.target.value})}
                      className="input text-sm" placeholder="Full name" />
                    <select value={editForm.role ?? 'reviewer'} onChange={e => setEditForm({...editForm, role: e.target.value})} className="input text-sm">
                      {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
                    </select>
                    <input value={editForm.discipline ?? ''} onChange={e => setEditForm({...editForm, discipline: e.target.value})}
                      className="input text-sm" placeholder="Discipline" />
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-900">{u.full_name}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${roleColors[u.role] ?? 'bg-slate-100'}`}>
                        {u.role.replace(/_/g,' ')}
                      </span>
                      {!u.active && <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">Inactive</span>}
                    </div>
                    <p className="text-xs text-slate-400">{u.email}{u.discipline ? ` · ${u.discipline}` : ''}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 shrink-0">
                  {editId === u.id ? (
                    <>
                      <button onClick={() => handleEdit(u.id)} disabled={saving} className="btn-primary text-xs py-1.5 px-3">
                        <Save className="h-3.5 w-3.5" /> Save
                      </button>
                      <button onClick={() => setEditId(null)} className="btn-secondary text-xs py-1.5 px-3">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => { setEditId(u.id); setEditForm({ full_name: u.full_name, role: u.role, discipline: u.discipline ?? '' }) }}
                      className="btn-secondary text-xs py-1.5 px-3">
                      <Edit3 className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
