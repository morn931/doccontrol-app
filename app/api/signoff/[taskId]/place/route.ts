/**
 * POST /api/signoff/[taskId]/place — move a signed signature or its date.
 * Body: { dx, dy, page?, target? } — nudge by dx/dy PDF points. `target: 'date'` moves the
 * date independently of the signature (defaults to the signature's own row/offset the first
 * time, then remembers its own position); omit or 'signature' moves the signature box (and the
 * date along with it, unless the date has already been independently positioned). Clamps to the
 * page, saves the new placement, and rebuilds the signed PDF from the clean base
 * (non-destructive). Allowed for the signatory or a sign-off controller.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { getFileBytesByUrl } from '@/lib/services/graph'
import { pageSizeOf, defaultDatePos } from '@/lib/signoff-pdf'
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
    .select('id, batch_id, signatory_email, status, place_page, place_x, place_y, place_w, place_h, place_date_x, place_date_y')
    .eq('id', taskId).single()
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
  const target: 'signature' | 'date' = body.target === 'date' ? 'date' : 'signature'
  const page = body.page != null ? Math.max(1, Math.floor(Number(body.page))) : (t.place_page ?? 1)

  const db2Clamp = async (x: number, y: number, w: number, h: number) => {
    const { data: batch } = await db.from('batches').select('signoff_pdf_url').eq('id', t.batch_id).single()
    const url = (batch as any)?.signoff_pdf_url
    if (!url) return { x, y }
    try {
      const bytes = await getFileBytesByUrl(url)
      const sz = await pageSizeOf(bytes, page)
      return { x: Math.min(Math.max(0, x), Math.max(0, sz.w - w)), y: Math.min(Math.max(0, y), Math.max(0, sz.h - h)) }
    } catch { return { x, y } }
  }

  if (target === 'date') {
    // First move ever for this signatory's date: start from wherever it's currently rendering
    // (relative to the signature), not some arbitrary new spot.
    const base = (t.place_date_x != null && t.place_date_y != null)
      ? { x: t.place_date_x, y: t.place_date_y }
      : defaultDatePos({ page: t.place_page, x: t.place_x, y: t.place_y, w: t.place_w, h: t.place_h })
    const { x: ndx, y: ndy } = await db2Clamp(base.x + dx, base.y + dy, 0, 0)
    await db.from('signoff_tasks').update({ place_date_x: ndx, place_date_y: ndy, updated_at: new Date().toISOString() }).eq('id', taskId)
    const rb = await rebuildBatchSignedPdf(db, t.batch_id)
    if (!rb.ok) return NextResponse.json({ error: rb.error ?? 'Could not re-stamp the date.' }, { status: 502 })
    return NextResponse.json({ ok: true, page, x: ndx, y: ndy, target })
  }

  const { x: nx, y: ny } = await db2Clamp(t.place_x + dx, t.place_y + dy, t.place_w ?? 0, t.place_h ?? 0)
  await db.from('signoff_tasks').update({ place_page: page, place_x: nx, place_y: ny, updated_at: new Date().toISOString() }).eq('id', taskId)
  const rb = await rebuildBatchSignedPdf(db, t.batch_id)
  if (!rb.ok) return NextResponse.json({ error: rb.error ?? 'Could not re-stamp the signature.' }, { status: 502 })

  return NextResponse.json({ ok: true, page, x: nx, y: ny, target })
}
