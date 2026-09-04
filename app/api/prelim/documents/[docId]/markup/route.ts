import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { prelimAuth, isErr } from '@/lib/prelim'

// The ROOM's markup layer — one shared layer per drawing, not one per reviewer, because
// the point of the session is everyone marking the same sheet at once. Same GET/POST/PATCH
// contract as the review and redline markup endpoints, so PdfMarkup drives it unchanged.
// Comments carry the author, so the shared layer still says who said what.
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const { docId } = await params
  const db = createServiceClient()
  const { data } = await db.from('prelim_document').select('markup_layer, markup_comments').eq('id', docId).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ markup: { layer: data.markup_layer, comments: data.markup_comments ?? [] } })
}

export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const { docId } = await params
  const body = await req.json().catch(() => ({}))
  const layer = body?.layer ?? {}
  const incoming: any[] = Array.isArray(body?.comments) ? body.comments : []
  const comments = incoming.map(c => ({ ...c, author: c?.author ?? auth.email, author_name: c?.author_name ?? auth.name ?? null }))
  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document').select('id, prelim_session!inner(status)').eq('id', docId).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((doc as any).prelim_session?.status !== 'open') return NextResponse.json({ error: 'This session is closed.' }, { status: 409 })
  const { error } = await db.from('prelim_document').update({ markup_layer: layer, markup_comments: comments }).eq('id', docId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, commentCount: comments.length })
}

// Tick a comment off the room's checklist.
export async function PATCH(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const { docId } = await params
  const { commentId, resolved } = await req.json().catch(() => ({}))
  const db = createServiceClient()
  const { data: row } = await db.from('prelim_document').select('markup_comments').eq('id', docId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const comments = ((row as any).markup_comments ?? []).map((c: any) => c.id === commentId
    ? { ...c, resolved: !!resolved, resolved_by: resolved ? auth.email : null, resolved_at: resolved ? new Date().toISOString() : null } : c)
  const { error } = await db.from('prelim_document').update({ markup_comments: comments }).eq('id', docId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
