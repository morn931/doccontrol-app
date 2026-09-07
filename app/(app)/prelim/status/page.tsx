import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { prelimStatus } from '@/lib/prelim/status'
import StatusView from './status-view'

export const dynamic = 'force-dynamic'

// Current Document Status — every drawing in every open session on one list, with where it
// is right now: not started · in review · sent to drawing office · sent to lead engineer ·
// returned · ready for tender. Read straight off prelim_document; nothing is typed here.
export default async function PrelimStatusPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = String(profile?.role ?? 'reviewer')
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.NAV_PRELIM_REVIEW, role)) redirect('/dashboard')

  const db = createServiceClient()
  const { data: docs } = await db.from('prelim_document')
    .select('id, session_id, document_number, revision, title, discipline, markup_layer, markup_comments, markup_committed_at, outcome, routing, routing_at, routing_by_email, routing_to_email, routing_to_name, routing_mailed_at, returned_at, returned_by_email, returned_from, quality_open, quality_checked_at, handed_over_batch_id, tender_stamped_file_url, prelim_session!inner(id, title, status)')
    .eq('prelim_session.status', 'open').order('created_at', { ascending: true }).limit(5000)

  const rows = (docs ?? []).map((d: any) => ({
    id: d.id, session_id: d.session_id, session: d.prelim_session.title,
    document_number: d.document_number, revision: d.revision, title: d.title, discipline: d.discipline,
    status: prelimStatus(d),
    commentCount: Array.isArray(d.markup_comments) ? d.markup_comments.length : 0,
    unsavedMarks: !!(d.markup_layer && typeof d.markup_layer === 'object' && Object.keys(d.markup_layer).length),
    markup_committed_at: d.markup_committed_at, outcome: d.outcome,
    routing: d.routing, routing_at: d.routing_at, routing_by_email: d.routing_by_email, routing_to_email: d.routing_to_email, routing_to_name: d.routing_to_name, routing_mailed_at: d.routing_mailed_at,
    returned_at: d.returned_at, returned_by_email: d.returned_by_email, returned_from: d.returned_from,
    quality_open: d.quality_open, quality_checked_at: d.quality_checked_at, handed_over_batch_id: d.handed_over_batch_id, tender_stamped_file_url: d.tender_stamped_file_url,
  }))
  return <StatusView docs={rows} />
}
