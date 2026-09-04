import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import PdfMarkup from '@/components/markup/pdf-markup'
import OutcomePanel from './outcome-panel'

export const dynamic = 'force-dynamic'

// One drawing in the room: the shared markup layer (everyone draws on the same layer, each
// in their own colour) and the room's call. "Save to SharePoint" flattens the marks into
// the working copy — that file is what hand-over sends into the formal review.
export default async function PrelimDocPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role, email').eq('auth_user_id', user.id).single()
  const role = String(profile?.role ?? 'reviewer')
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.NAV_PRELIM_REVIEW, role)) redirect('/dashboard')
  const canManage = can(perms, FK.ACTION_PRELIM_MANAGE, role)

  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document')
    .select('id, document_number, revision, title, source_file_name, working_file_name, outcome, outcome_note, rework_to_email, handed_over_batch_id, markup_committed_at, prelim_session!inner(id, title, status)')
    .eq('id', docId).eq('session_id', id).maybeSingle()
  if (!doc) redirect(`/prelim/${id}`)
  const s = (doc as any).prelim_session
  const open = s.status === 'open' && !(doc as any).handed_over_batch_id

  // A colour per person, stable across the session, so the shared layer still shows who drew what.
  const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5']
  const email = profile?.email ?? user.email ?? ''
  let h = 0; for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const myColor = PALETTE[h % PALETTE.length]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={`/prelim/${id}`} className="btn-secondary text-xs py-1.5 px-3"><ArrowLeft className="h-3.5 w-3.5" /> {s.title}</Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-600 px-2.5 py-0.5 text-xs font-medium">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: myColor }} /> Your colour on the shared layer
        </span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{(doc as any).document_number ?? (doc as any).title ?? (doc as any).source_file_name}{(doc as any).revision ? <span className="text-slate-400 font-normal text-base"> rev {(doc as any).revision}</span> : null}</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          {(doc as any).title && (doc as any).document_number ? `${(doc as any).title} · ` : ''}
          Everyone in the room draws on the same layer. <b>Save draft</b> keeps it editable; <b>☁ Save to SharePoint</b> writes the marks into the working copy, which is what hand-over sends into internal review.
        </p>
      </div>
      <OutcomePanel docId={docId} sessionId={id} outcome={(doc as any).outcome} note={(doc as any).outcome_note} reworkTo={(doc as any).rework_to_email} handedOver={!!(doc as any).handed_over_batch_id} handedOverBatchId={(doc as any).handed_over_batch_id} open={open} canManage={canManage} />
      <PdfMarkup src={`/api/prelim/documents/${docId}/file`} fileName={((doc as any).working_file_name ?? 'document').replace(/\.pdf$/i, '')} endpointBase={`/api/prelim/documents/${docId}`} initialColor={myColor} readOnly={!open} />
    </div>
  )
}
