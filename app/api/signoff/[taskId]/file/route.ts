/**
 * GET /api/signoff/[taskId]/file — streams the current sign-off PDF bytes inline, so the
 * sign page can render it in an <iframe> without exposing the SharePoint URL. Allowed for
 * the assigned signatory or anyone who can start sign-off (controllers).
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { getFileBytesByUrl } from '@/lib/services/graph'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).maybeSingle()

  const { taskId } = await params
  const db = createServiceClient()
  const { data: task } = await db.from('signoff_tasks').select('batch_id, signatory_email').eq('id', taskId).single()
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isSignatory = (task as any).signatory_email.toLowerCase() === user.email.toLowerCase()
  const perms = await getPermissions(supabase)
  const isController = can(perms, FK.ACTION_START_SIGNOFF, (profile?.role ?? 'reviewer') as any)
  if (!isSignatory && !isController) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: batch } = await db.from('batches').select('signoff_pdf_url').eq('id', (task as any).batch_id).single()
  const url = (batch as any)?.signoff_pdf_url
  if (!url) return NextResponse.json({ error: 'No sign-off PDF yet.' }, { status: 404 })

  try {
    const bytes = await getFileBytesByUrl(url)
    return new NextResponse(Buffer.from(bytes as ArrayBuffer), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="signoff.pdf"', 'Cache-Control': 'no-store' },
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Could not load the PDF: ${e?.message ?? e}` }, { status: 502 })
  }
}
