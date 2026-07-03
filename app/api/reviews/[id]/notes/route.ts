import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Internal reviewer-to-reviewer handover notes for a document (see migration 010).
// Notes accumulate per document_version; not part of the transmittal.
async function taskCtx(db: any, id: string) {
  const { data } = await db.from('review_tasks').select('id, document_version_id, batch_id').eq('id', id).single()
  return data
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const db = createServiceClient()
  const task = await taskCtx(db, id)
  if (!task) return NextResponse.json({ notes: [] })
  const { data: notes } = await db.from('reviewer_notes')
    .select('id, author_email, author_name, note_text, created_at')
    .eq('document_version_id', task.document_version_id)
    .order('created_at', { ascending: true })
  return NextResponse.json({ notes: notes ?? [] })   // degrades to [] if table absent
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const { note } = await req.json()
  const text = String(note ?? '').trim()
  if (!text) return NextResponse.json({ error: 'Note is required' }, { status: 400 })

  const db = createServiceClient()
  const task = await taskCtx(db, id)
  if (!task) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  const { data: profile } = await db.from('users').select('email, full_name').eq('auth_user_id', user.id).single()

  const { error } = await db.from('reviewer_notes').insert({
    document_version_id: task.document_version_id,
    batch_id:            task.batch_id,
    review_task_id:      task.id,
    author_email:        (profile as any)?.email ?? user.email ?? '',
    author_name:         (profile as any)?.full_name ?? null,
    note_text:           text,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
