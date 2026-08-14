/**
 * POST /api/signoff/[taskId]/place — move a signed signature.
 * Body: { dx, dy, page? } — nudge the signature box by dx/dy PDF points (and optionally move it
 * to another page). Clamps to the page, saves the new placement, and rebuilds the signed PDF
 * from the clean base (non-destructive). Allowed for the signatory or a sign-off controller.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { getFileBytesByUrl } from '@/lib/services/graph'
import { pageSizeOf } from '@/lib/signoff-pdf'
import { rebuildBatchSignedPdf } from '@/lib/signoff-rebuild'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).maybeSingle()

  const { taskId } = await params
  const db = createServiceClient()
  const { data: task } = await db.from('signoff_tasks')
    .select('id, batch_id, signatory_email, status, place_page, place_x, place_y, place_w, place_h').eq('id', taskId).single()
  const t = task as any
  if (!t) return NextResponse.json({ error: 'Sign-off task not found' }, { status: 404 })

  const isSignatory = t.signatory_email.toLowerCase() === user.email.toLowerCase()
  const perms = await getPermissions(supabase)
  const isController = can(perms, FK.ACTION_START_SIGNOFF, (profile?.role ?? 'reviewer') as any)
  if (!isSignatory && !isController) return NextResponse.json({ error: 'Only the signatory or a controller can move this signature.' }, { status: 403 })
  if (t.status !== 'signed') return NextResponse.json({ error: 'Sign the document before moving the signature.' }, { status: 400 })
  if (t.place_x == null) return NextResponse.json({ error: 'This signature has no recorded position to move.' }, { status: 400 })

  const body = await req.json().catch(() => ({} as any))
  const dx = Number(body.dx ?? 0), dy = Number(body.dy ?? 0)
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return NextResponse.json({ error: 'Bad nudge values.' }, { status: 400 })
  const page = body.page != null ? Math.max(1, Math.floor(Number(body.page))) : (t.place_page ?? 1)

  let nx = t.place_x + dx, ny = t.place_y + dy
  const { data: batch } = await db.from('batches').select('signoff_pdf_url').eq('id', t.batch_id).single()
  const url = (batch as any)?.signoff_pdf_url
  if (url) {
    try {
      const bytes = await getFileBytesByUrl(url)
      const sz = await pageSizeOf(bytes, page)
      nx = Math.min(Math.max(0, nx), Math.max(0, sz.w - (t.place_w ?? 0)))
      ny = Math.min(Math.max(0, ny), Math.max(0, sz.h - (t.place_h ?? 0)))
    } catch { /* clamp best-effort */ }
  }

  await db.from('signoff_tasks').update({ place_page: page, place_x: nx, place_y: ny, updated_at: new Date().toISOString() }).eq('id', taskId)
  const rb = await rebuildBatchSignedPdf(db, t.batch_id)
  if (!rb.ok) return NextResponse.json({ error: rb.error ?? 'Could not re-stamp the signature.' }, { status: 502 })

  return NextResponse.json({ ok: true, page, x: nx, y: ny })
}
