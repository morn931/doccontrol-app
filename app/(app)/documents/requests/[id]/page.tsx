import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import AllocatePanel, { type LineForAlloc } from './allocate-panel'

export const dynamic = 'force-dynamic'

type Line = LineForAlloc & { line_no: number | null; revision: string | null; due_date: string | null; comments: string | null }

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = (profile?.role ?? 'reviewer') as string
  const perms = await getPermissions(supabase)
  const canAssign = can(perms, FK.ACTION_ASSIGN_DOC_NUMBER, role)

  const { data: req } = await supabase.from('document_number_request').select('*').eq('id', id).single()
  if (!req) notFound()
  const { data: lineRows } = await supabase.from('document_number_request_line').select('*').eq('request_id', id).order('line_no')
  const { data: lookups } = await supabase.from('doc_lookup').select('kind, code, name')
  const lk = (lookups ?? []) as { kind: string; code: string; name: string }[]
  const nm = (kind: string, code: string | null) => (code ? (lk.find((l) => l.kind === kind && l.code === code)?.name ?? code) : '—')
  const lines = (lineRows ?? []) as Line[]

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{req.request_no ?? 'Document number request'}</h1>
          <p className="text-sm text-slate-500">
            {req.requestor_email ?? '—'} · {req.package_code ?? 'no package'}{req.response_required_by ? ` · response by ${req.response_required_by}` : ''} · <span className="font-medium">{req.status}</span>
          </p>
        </div>
        <Link href="/documents/requests" className="text-sm font-medium text-teal-700 hover:underline">← Requests</Link>
      </div>

      {req.status === 'assigned' && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✅ All numbers allocated — the requestor <b>{req.requestor_email ?? '—'}</b> has been emailed the allocated numbers.
        </div>
      )}

      {!canAssign && (
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Read-only — the Document Controller allocates the RDMC numbers. You&apos;ll see them appear here once assigned.
        </p>
      )}

      <div className="space-y-3">
        {lines.map((l) => (
          <div key={l.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-500">Line {l.line_no} · Rev {l.revision ?? 'A'}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                <div><span className="text-slate-400">Type:</span> {nm('document_type', l.document_type_code)} <span className="text-slate-300">({l.document_type_code ?? '—'})</span></div>
                <div><span className="text-slate-400">Discipline:</span> {nm('discipline', l.discipline_code)} <span className="text-slate-300">({l.discipline_code ?? '—'})</span></div>
                <div className="col-span-2"><span className="text-slate-400">Area/WBS:</span> {l.area_code ?? '—'} {nm('wbs_area', l.area_code) !== (l.area_code ?? '—') ? `— ${nm('wbs_area', l.area_code)}` : ''}</div>
                <div className="col-span-2"><span className="text-slate-400">Title:</span> {[l.title1, l.title2, l.title3].filter(Boolean).join(' — ') || '—'}</div>
                {l.comments && <div className="col-span-2"><span className="text-slate-400">Comments:</span> {l.comments}</div>}
              </div>
            </div>
            <div>
              {canAssign ? (
                <AllocatePanel line={l} projectNumber={req.project_number ?? '6105A'} packageCode={req.package_code ?? null} />
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Allocated</div>
                  <div className="mt-1 font-mono text-sm text-slate-800">{l.rdmc_document_number ?? '— not yet allocated —'}</div>
                  {l.ppe_doc_number && <div className="mt-1 text-slate-500">PPE: {l.ppe_doc_number}</div>}
                  {l.full_title && <div className="text-slate-500">{l.full_title}</div>}
                </div>
              )}
            </div>
          </div>
        ))}
        {lines.length === 0 && <p className="text-sm text-slate-400">No lines on this request.</p>}
      </div>
    </div>
  )
}
