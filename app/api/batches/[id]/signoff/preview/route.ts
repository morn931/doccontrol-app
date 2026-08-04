/**
 * GET /api/batches/[id]/signoff/preview
 * Renders the internal-review batch's native file to PDF (via Graph) and returns it inline,
 * so the controller can eyeball it — especially Excel pagination — BEFORE routing for sign-off.
 * Read-only; changes nothing.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { resolveDriveItemByUrl, getDriveItemContentBytes } from '@/lib/services/graph'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_START_SIGNOFF, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = createServiceClient()
  const { data: batch } = await db.from('batches')
    .select('id, source, document_versions(central_file_url, file_name)')
    .eq('id', id).single()
  const b = batch as any
  if (!b) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  const dv = (b.document_versions ?? [])[0]
  if (!dv?.central_file_url) return NextResponse.json({ error: 'No source file on this batch.' }, { status: 400 })

  try {
    const item = await resolveDriveItemByUrl(dv.central_file_url)
    if (!item?.driveId) return NextResponse.json({ error: 'Could not locate the source file in SharePoint.' }, { status: 404 })
    const pdf = await getDriveItemContentBytes(item.driveId, item.id, 'pdf')
    return new NextResponse(Buffer.from(pdf as ArrayBuffer), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="signoff-preview.pdf"' },
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Could not render to PDF: ${e?.message ?? e}` }, { status: 502 })
  }
}
