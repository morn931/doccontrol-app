import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import InternalTracker, { type TrackerRow } from './internal-tracker'

export const dynamic = 'force-dynamic'

// Document-Controller tracker for INTERNAL documents (both intake paths: 'internal' engineering
// drawing-requests and 'internal_review'). One row per document showing the current stage, who
// holds it now, how long it's been there, and the next action — so the DC can chase people.

const OPEN_REVIEW = ['completed', 'declined']       // a reviewer task is CLOSED at these
const CLOSED_SIGNOFF = ['signed', 'declined']

function displayName(nameBy: Record<string, string>, email?: string | null): string {
  if (!email) return '—'
  return nameBy[email.toLowerCase()] ?? email.split('@')[0]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeStage(b: any, nameBy: Record<string, string>) {
  const st = b.status as string
  const rts = [...(b.review_tasks ?? [])].sort((a: any, c: any) => a.sequence_number - c.sequence_number)
  const sts = [...(b.signoff_tasks ?? [])].sort((a: any, c: any) => a.sequence_number - c.sequence_number)
  const now = Date.now()

  if (st === 'signed') return { key: 'signed', label: 'Signed — ready to issue', holder: 'Document Control', action: 'Issue to Aconex' }
  if (st === 'transmittal_generated') return { key: 'issued', label: 'Returned to engineer', holder: 'Document Control', action: 'Send for sign-off' }
  if (st === 'signoff_declined') {
    const dec = sts.find((t: any) => t.status === 'declined')
    return { key: 'declined', label: 'Sign-off declined', holder: 'Document Control', note: dec?.decline_reason ?? null, action: 'Correct & re-send' }
  }
  if (st === 'signoff_in_progress' || (st === 'review_complete' && sts.length)) {
    const cur = sts.find((t: any) => !CLOSED_SIGNOFF.includes(t.status))
    if (cur) return { key: 'in_signoff', label: 'In sign-off', holder: displayName(nameBy, cur.signatory_email), holderMeta: cur.role_label ?? null, action: 'Chase signatory' }
    return { key: 'in_signoff', label: 'Sign-off', holder: 'Document Control', action: '—' }
  }
  if (st === 'review_complete') return { key: 'awaiting_signoff', label: 'Review complete', holder: 'Document Control', action: 'Send for sign-off' }
  if (st === 'review_in_progress') {
    const cur = rts.find((t: any) => !OPEN_REVIEW.includes(t.status))
    const overdue = !!(cur?.due_date && new Date(cur.due_date).getTime() < now)
    return { key: 'in_review', label: 'In review', holder: displayName(nameBy, cur?.reviewer_email), holderMeta: cur?.status ?? null, overdue, action: 'Chase reviewer' }
  }
  if (st === 'review_ready_to_start') return { key: 'setup', label: 'Review not started', holder: 'Document Control', action: 'Start review' }
  if (st === 'metadata_pending') return { key: 'setup', label: 'Awaiting reviewer assignment', holder: 'Document Control', action: 'Assign reviewers' }
  return { key: 'other', label: st, holder: '—', action: '—' }
}

export default async function InternalTrackerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const { data: batches } = await db.from('batches')
    .select(`id, source, status, internal_ref, updated_at, received_at,
             document_versions(file_name, doc_name, revision),
             review_tasks(reviewer_email, sequence_number, status, date_sent, due_date, date_completed),
             signoff_tasks(signatory_email, role_label, sequence_number, status, signed_at, decline_reason)`)
    .in('source', ['internal', 'internal_review'])
    .order('updated_at', { ascending: false })
    .limit(1000)

  const list = (batches ?? []) as any[] // eslint-disable-line @typescript-eslint/no-explicit-any
  const emails = new Set<string>()
  for (const b of list) {
    for (const t of b.review_tasks ?? []) if (t.reviewer_email) emails.add(t.reviewer_email.toLowerCase())
    for (const t of b.signoff_tasks ?? []) if (t.signatory_email) emails.add(t.signatory_email.toLowerCase())
  }
  const nameBy: Record<string, string> = {}
  if (emails.size) {
    const { data: users } = await db.from('users').select('email, full_name').in('email', [...emails])
    for (const u of (users ?? []) as any[]) if (u.email) nameBy[u.email.toLowerCase()] = u.full_name ?? u.email // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  const now = Date.now()
  const rows: TrackerRow[] = list.map((b) => {
    const dv = (b.document_versions ?? [])[0]
    const docNo = dv?.file_name ? String(dv.file_name).replace(/\.[^.]+$/, '').replace(/_[A-Za-z0-9]{1,4}$/, '') : null
    const s = computeStage(b, nameBy)
    const daysInStage = b.updated_at ? Math.max(0, Math.floor((now - new Date(b.updated_at).getTime()) / 86400000)) : 0
    return {
      id: b.id,
      docNo: docNo ?? (b.internal_ref ?? 'Internal document'),
      title: dv?.doc_name ?? null,
      revision: dv?.revision ?? null,
      source: b.source,
      stageKey: s.key,
      stageLabel: s.label,
      holder: s.holder,
      holderMeta: (s as any).holderMeta ?? null, // eslint-disable-line @typescript-eslint/no-explicit-any
      overdue: !!(s as any).overdue, // eslint-disable-line @typescript-eslint/no-explicit-any
      note: (s as any).note ?? null, // eslint-disable-line @typescript-eslint/no-explicit-any
      action: s.action,
      daysInStage,
    }
  })

  return <InternalTracker rows={rows} />
}
