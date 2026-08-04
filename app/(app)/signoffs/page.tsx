import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { PenLine, ChevronRight, Clock } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function SignoffsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return <div className="card p-8 text-center text-slate-400">Please sign in.</div>

  const db = createServiceClient()
  const { data } = await db.from('signoff_tasks')
    .select('id, status, role_label, sequence_number, batch_id, batches(internal_ref, status, document_versions(doc_name, file_name))')
    .ilike('signatory_email', user.email)
    .not('status', 'in', '(signed,declined)')
    .order('created_at', { ascending: false })

  const tasks = (data ?? []) as any[]
  const mine = tasks.map(t => {
    const dv = (t.batches?.document_versions ?? [])[0]
    return { ...t, title: dv?.doc_name ?? dv?.file_name ?? 'Document', ref: t.batches?.internal_ref }
  })
  const active = mine.filter(t => ['sent', 'opened'].includes(t.status))
  const upcoming = mine.filter(t => t.status === 'pending')

  function Row({ t, actionable }: { t: any; actionable: boolean }) {
    const inner = (
      <div className={`px-5 py-3 flex items-center gap-3 ${actionable ? 'hover:bg-slate-50' : ''}`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${actionable ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>
          {actionable ? <PenLine className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-slate-900 truncate">{t.title}</p>
          <p className="text-xs text-slate-400">{[t.ref, t.role_label && `Signing as ${t.role_label}`, `Position ${t.sequence_number}`].filter(Boolean).join(' · ')}</p>
        </div>
        {actionable ? <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" /> : <span className="text-xs text-slate-400 shrink-0">waiting for earlier signatory</span>}
      </div>
    )
    return actionable ? <Link href={`/signoff/${t.id}`} className="block">{inner}</Link> : inner
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <PenLine className="h-5 w-5 text-teal-600" />
        <h1 className="text-xl font-bold text-slate-900">My Sign-offs</h1>
      </div>

      <div className="card">
        <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-semibold text-sm text-slate-900">Awaiting your signature ({active.length})</h2></div>
        <div className="divide-y divide-slate-50">
          {active.length === 0 ? <div className="px-5 py-8 text-center text-sm text-slate-400">Nothing awaiting your signature.</div>
            : active.map(t => <Row key={t.id} t={t} actionable />)}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-semibold text-sm text-slate-900">Upcoming ({upcoming.length})</h2></div>
          <div className="divide-y divide-slate-50">{upcoming.map(t => <Row key={t.id} t={t} actionable={false} />)}</div>
        </div>
      )}
    </div>
  )
}
