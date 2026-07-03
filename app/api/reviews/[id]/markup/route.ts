import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Persist / load a reviewer's in-app markup layer + captured text comments for a
// document (see migration 011). Keyed by (document_version, review_task) so each
// reviewer resumes their own draft.
async function taskCtx(db: any, id: string) {
  const { data } = await db.from('review_tasks').select('id, document_version_id').eq('id', id).single()
  return data
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const db = createServiceClient()
  const task = await taskCtx(db, id)
  if (!task) return NextResponse.json({ markup: null })
  const { data } = await db.from('document_markups')
    .select('layer, comments, updated_at')
    .eq('document_version_id', task.document_version_id)
    .eq('review_task_id', task.id)
    .maybeSingle()
  return NextResponse.json({ markup: data ?? null })   // null if none / table absent
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const layer = body?.layer ?? {}
  const comments = Array.isArray(body?.comments) ? body.comments : []

  const db = createServiceClient()
  const task = await taskCtx(db, id)
  if (!task) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  const { data: profile } = await db.from('users').select('email, full_name').eq('auth_user_id', user.id).single()

  const { error } = await db.from('document_markups').upsert({
    document_version_id: task.document_version_id,
    review_task_id:      task.id,
    author_email:        (profile as any)?.email ?? user.email ?? '',
    author_name:         (profile as any)?.full_name ?? null,
    layer, comments,
    updated_at:          new Date().toISOString(),
  }, { onConflict: 'document_version_id,review_task_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, commentCount: comments.length })
}
