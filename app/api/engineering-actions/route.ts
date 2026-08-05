import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
// Per the Engineering Manager (2026-08): NO instant per-action emails — people check the
// register, and a daily per-person digest (api/cron/engineering-actions-digest) nudges them
// with their outstanding count + new answers on things they raised.

// GET /api/engineering-actions
//   ?assignees=1                 → directory of assignable users (for the picker)
//   ?batchId= / ?reviewTaskId=   → actions logged on that document (banner view)
//   (no scope)                   → the whole register (register page)
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const db = createServiceClient()
  const u = new URL(req.url)

  if (u.searchParams.get('assignees')) {
    const { data } = await db.from('users').select('email, full_name, role').order('full_name')
    return NextResponse.json({ users: data ?? [] })
  }

  let batchId = u.searchParams.get('batchId')
  const reviewTaskId = u.searchParams.get('reviewTaskId')
  if (reviewTaskId && !batchId) {
    const { data: t } = await db.from('review_tasks').select('batch_id').eq('id', reviewTaskId).single()
    batchId = (t as any)?.batch_id ?? null
  }

  let q = db.from('engineering_action').select('*').order('created_at', { ascending: false }).limit(2000)
  if (batchId) q = q.eq('batch_id', batchId)
  const { data: actions } = await q

  // Attach reply threads
  const ids = (actions ?? []).map((a: any) => a.id)
  let replies: any[] = []
  if (ids.length) {
    const { data } = await db.from('engineering_action_reply').select('*').in('action_id', ids).order('created_at')
    replies = data ?? []
  }
  const byAction: Record<string, any[]> = {}
  for (const r of replies) (byAction[r.action_id] ??= []).push(r)
  const withReplies = (actions ?? []).map((a: any) => ({ ...a, replies: byAction[a.id] ?? [] }))
  return NextResponse.json({ actions: withReplies })
}

// POST /api/engineering-actions — raise an action.
// From a review: pass { reviewTaskId, description, assignedToEmail, assignedToName, discipline, priority }.
// Manual (register page): pass { documentNumber, description, assignedToEmail, ... } with no reviewTaskId.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const b = await req.json().catch(() => ({} as any))
  const description = String(b.description ?? '').trim()
  if (!description) return NextResponse.json({ error: 'The action is required.' }, { status: 400 })

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email, full_name').eq('auth_user_id', user.id).single()

  // Resolve the document context from the review task, when raised from a review.
  let document_number = b.documentNumber ?? null, document_version_id = null, batch_id = null
  if (b.reviewTaskId) {
    const { data: t } = await db.from('review_tasks').select('id, document_version_id, batch_id').eq('id', b.reviewTaskId).single()
    if (t) {
      document_version_id = (t as any).document_version_id
      batch_id = (t as any).batch_id
      const { data: dv } = await db.from('document_versions').select('doc_unique_id, doc_name, discipline').eq('id', document_version_id).maybeSingle()
      document_number = document_number ?? (dv as any)?.doc_unique_id ?? (dv as any)?.doc_name ?? null
      if (!b.discipline && (dv as any)?.discipline) b.discipline = (dv as any).discipline
    }
  }

  const row = {
    record_type: 'action',
    raised_by_email: (profile as any)?.email ?? user.email ?? '',
    raised_by_name: (profile as any)?.full_name ?? null,
    document_number, document_version_id, batch_id,
    discipline: b.discipline ?? null,
    area_system: b.areaSystem ?? null,
    title: b.title ? String(b.title).slice(0, 160) : description.slice(0, 80),
    description,
    assigned_to_email: b.assignedToEmail ?? null,
    assigned_to_name: b.assignedToName ?? null,
    priority: ['low', 'medium', 'high'].includes(b.priority) ? b.priority : null,
    source: b.reviewTaskId ? 'design_review' : 'manual',
    status: 'open',
  }
  const { data: created, error } = await db.from('engineering_action').insert(row).select('id, action_ref').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // No email here — the daily digest covers assignees (EM's preference).
  return NextResponse.json({ ok: true, id: (created as any).id, action_ref: (created as any).action_ref }, { status: 201 })
}
