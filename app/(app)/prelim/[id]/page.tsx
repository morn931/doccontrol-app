import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import SessionView from './session-view'

export const dynamic = 'force-dynamic'

export default async function PrelimSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const role = String(profile?.role ?? 'reviewer')
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.NAV_PRELIM_REVIEW, role)) redirect('/dashboard')
  const canManage = can(perms, FK.ACTION_PRELIM_MANAGE, role)

  const db = createServiceClient()
  const { data: session } = await db.from('prelim_session').select('*').eq('id', id).maybeSingle()
  if (!session) redirect('/prelim')
  const { data: docs } = await db.from('prelim_document')
    .select('id, document_number, revision, title, discipline, document_type, source_file_name, source_file_url, working_file_name, cddl_doc_id, markup_comments, markup_layer, markup_committed_at, outcome, outcome_note, outcome_by_email, outcome_at, rework_to_email, handed_over_batch_id, handed_over_at, pulled_by_email, created_at, quality_latest, quality_open, quality_checked_at, quality_source_modified_at')
    .eq('session_id', id).order('created_at', { ascending: true })

  const rows = (docs ?? []).map((d: any) => ({
    ...d,
    commentCount: Array.isArray(d.markup_comments) ? d.markup_comments.length : 0,
    unsavedMarks: !!(d.markup_layer && typeof d.markup_layer === 'object' && Object.keys(d.markup_layer).length),
    markup_layer: undefined, markup_comments: undefined,
    // only the issues travel to the browser, not the whole report
    qualityIssues: Array.isArray(d.quality_latest?.issues) ? d.quality_latest.issues : null,
    qualityOverall: d.quality_latest?.overall ?? null,
    quality_latest: undefined,
  }))

  return <SessionView session={session as any} docs={rows} canManage={canManage} />
}
