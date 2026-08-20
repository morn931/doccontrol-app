/**
 * GET /api/cddl/search?q=...
 *
 * Type-ahead search over the CDDL register (cddl_doc) for the Sign-off Intake — the DC picks the
 * document she's uploading a sign-off-only revision for. The CDDL is the master register of every
 * document (synced from the workbook), so it's the right source even for documents that never went
 * through the CoreDocs document-request flow. Gated by ACTION_APPROVE_SIGNOFF_ONLY.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_APPROVE_SIGNOFF_ONLY, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })
  const like = `*${q.replace(/[%,()]/g, ' ')}*`

  const db = createServiceClient()
  const { data } = await db.from('cddl_doc')
    .select('id, package_code, docno, title, discipline, doc_type, revision, aconex_review_status, doc_owner')
    .or(`docno.ilike.${like},title.ilike.${like}`)
    .order('docno')
    .limit(25)

  return NextResponse.json({ results: data ?? [] })
}
