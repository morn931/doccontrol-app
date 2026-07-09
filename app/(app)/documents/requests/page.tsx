import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, string> = {
  submitted: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-sky-100 text-sky-700',
  assigned: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-slate-100 text-slate-400',
  draft: 'bg-slate-100 text-slate-500',
}

type Req = { id: string; request_no: string | null; requestor_email: string | null; package_code: string | null; response_required_by: string | null; status: string; created_at: string }

export default async function RequestsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = (profile?.role ?? 'reviewer') as string
  const perms = await getPermissions(supabase)
  const canRequest = can(perms, FK.ACTION_REQUEST_DOC_NUMBER, role)

  const { data: reqs } = await supabase.from('document_number_request')
    .select('id, request_no, requestor_email, package_code, response_required_by, status, created_at')
    .order('created_at', { ascending: false })
  const { data: lines } = await supabase.from('document_number_request_line').select('request_id, line_status')
  const counts = new Map<string, { total: number; assigned: number }>()
  for (const l of (lines ?? []) as { request_id: string; line_status: string }[]) {
    const c = counts.get(l.request_id) ?? { total: 0, assigned: 0 }
    c.total++; if (l.line_status === 'assigned') c.assigned++; counts.set(l.request_id, c)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Document number requests</h1>
          <p className="text-sm text-slate-500">Engineers request numbers here; Document Control allocates them.</p>
        </div>
        {canRequest && <Link href="/documents/request" className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800">+ New request</Link>}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Request</th>
              <th className="px-3 py-2 font-medium">Requestor</th>
              <th className="px-3 py-2 font-medium">Package</th>
              <th className="px-3 py-2 font-medium">Lines</th>
              <th className="px-3 py-2 font-medium">Response by</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {((reqs ?? []) as Req[]).map((r) => {
              const c = counts.get(r.id) ?? { total: 0, assigned: 0 }
              return (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2"><Link href={`/documents/requests/${r.id}`} className="font-medium text-teal-700 hover:underline">{r.request_no ?? '—'}</Link></td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.requestor_email ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.package_code ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{c.assigned}/{c.total} allocated</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.response_required_by ?? '—'}</td>
                  <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[r.status] ?? 'bg-slate-100 text-slate-500'}`}>{r.status}</span></td>
                </tr>
              )
            })}
            {(reqs ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">No requests yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
