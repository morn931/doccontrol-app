import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { prelimStatus } from '@/lib/prelim/status'
import ReturnsView from './returns-view'

export const dynamic = 'force-dynamic'

// Return from Drawing Office / Lead Engineer — drop the corrected PDF here. It becomes the
// drawing's working copy, the before-tender buttons unlock, and the drawing joins the list
// below with its current status (returned → and then whatever the reviewer calls next).
export default async function PrelimReturnsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = String(profile?.role ?? 'reviewer')
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.NAV_PRELIM_REVIEW, role)) redirect('/dashboard')

  const db = createServiceClient()
  const { data: docs } = await db.from('prelim_document')
    .select('id, session_id, document_number, revision, title, markup_layer, markup_comments, markup_committed_at, outcome, routing, routing_at, routing_by_email, routing_to_email, routing_to_name, routing_mailed_at, returned_at, returned_by_email, returned_from, returned_file_name, returned_file_url, routing_history, prelim_session!inner(id, title, status)')
    .eq('prelim_session.status', 'open').not('returned_at', 'is', null).order('returned_at', { ascending: false }).limit(5000)

  const rows = (docs ?? []).map((d: any) => ({
    id: d.id, session_id: d.session_id, session: d.prelim_session.title, document_number: d.document_number, revision: d.revision, title: d.title,
    status: prelimStatus(d),
    returned_at: d.returned_at, returned_by_email: d.returned_by_email, returned_from: d.returned_from, returned_file_name: d.returned_file_name, returned_file_url: d.returned_file_url,
    routing: d.routing, routing_at: d.routing_at, routing_by_email: d.routing_by_email, routing_to_name: d.routing_to_name, routing_to_email: d.routing_to_email,
    timesReturned: Array.isArray(d.routing_history) ? d.routing_history.filter((h: any) => h?.event === 'returned').length : 0,
  }))
  return <ReturnsView docs={rows} />
}
