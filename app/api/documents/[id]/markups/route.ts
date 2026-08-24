/**
 * GET /api/documents/[id]/markups   ([id] = document_version_id)
 *
 * Aggregates the reviewer comments across ALL reviewers of one document version, for the
 * originator's comment checklist. The per-review-task GET at app/api/reviews/[id]/markup only
 * returns one reviewer's row; this one unions every reviewer's `comments` for the version,
 * tagging each with its owning review_task_id (so ticking reuses the existing PATCH) and the
 * reviewer's name + sequence colour.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Same per-reviewer palette the markup workspace uses (reviews/[id]/markup/page.tsx).
const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d']

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params // document_version_id

  const db = createServiceClient()
  const [{ data: rows }, { data: tasks }] = await Promise.all([
    db.from('document_markups').select('review_task_id, author_email, author_name, comments').eq('document_version_id', id),
    db.from('review_tasks').select('id, reviewer_email, sequence_number, status').eq('document_version_id', id).order('sequence_number'),
  ])
  const taskById: Record<string, any> = {}
  for (const t of (tasks ?? []) as any[]) taskById[t.id] = t

  const comments: any[] = []
  for (const r of (rows ?? []) as any[]) {
    const t = taskById[r.review_task_id]
    const seqColor = PALETTE[(((t?.sequence_number ?? 1) - 1) % PALETTE.length + PALETTE.length) % PALETTE.length]
    for (const c of (r.comments ?? [])) {
      if (!c?.text) continue
      comments.push({
        ...c,
        review_task_id: r.review_task_id,
        reviewer: r.author_name ?? r.author_email ?? t?.reviewer_email ?? 'Reviewer',
        color: c.color ?? seqColor,
      })
    }
  }
  // Page order, then top-to-bottom within a page — the order the originator reads them.
  comments.sort((a, b) => (a.page - b.page) || (a.y - b.y))

  const resolved = comments.filter((c) => c.resolved).length
  return NextResponse.json({ comments, total: comments.length, resolved })
}
