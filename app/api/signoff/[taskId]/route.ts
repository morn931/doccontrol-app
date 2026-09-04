/**
 * GET /api/signoff/[taskId] — context for the sign page: the task, its batch, whether it's
 * THIS user's turn to sign, and whether they have a signature on file. Marks a 'sent' task
 * as 'opened' when the assigned signatory opens it.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const SHELL_URL = process.env.COREFLOW_SHELL_URL || 'https://coreflow.build'

/** The signer's own stored signature, so the page can SHOW what is about to be stamped.
 *  Worth the round trip: 17 of the 25 signatures on file carry an opaque block of scanned
 *  paper (measured 2026-09-04), which lands as a white box across the drawing, and nobody
 *  could see that coming until it was on the document. Only ever the caller's own image. */
async function signatureFor(email: string): Promise<string | null> {
  const secret = process.env.SIGNATURE_LOOKUP_SECRET
  if (!secret) return null
  try {
    const res = await fetch(`${SHELL_URL}/api/signature/by-email?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()).signature?.image ?? null
  } catch { return null }
}

export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('full_name').eq('auth_user_id', user.id).maybeSingle()

  const { taskId } = await params
  const db = createServiceClient()
  const { data: task } = await db.from('signoff_tasks')
    .select('id, batch_id, signatory_email, signatory_name, role_label, sequence_number, status, block_row')
    .eq('id', taskId).single()
  if (!task) return NextResponse.json({ error: 'Sign-off task not found' }, { status: 404 })

  const { data: batch } = await db.from('batches')
    .select('id, internal_ref, status, signoff_pdf_url, document_versions(doc_name, file_name)')
    .eq('id', (task as any).batch_id).single()
  const { data: siblings } = await db.from('signoff_tasks')
    .select('sequence_number, status, signatory_name, signatory_email').eq('batch_id', (task as any).batch_id)

  const t = task as any
  const isMine = t.signatory_email.toLowerCase() === user.email.toLowerCase()
  const earlierOpen = (siblings ?? []).filter((s: any) => s.sequence_number < t.sequence_number && !['signed', 'declined'].includes(s.status))
  const canSign = isMine && ['sent', 'opened'].includes(t.status) && earlierOpen.length === 0

  // Signing used to be a one-way door. It can be undone — the PDF is rebuilt from the clean
  // base each time, so a withdrawn signature simply isn't stamped — but only while nobody has
  // signed AFTER you: their approval was given to the document your signature was part of.
  const laterSigned = (siblings ?? []).filter((s: any) => s.sequence_number > t.sequence_number && s.status === 'signed')
  const canWithdraw = isMine && t.status === 'signed' && laterSigned.length === 0
  const withdrawBlockedBy = isMine && t.status === 'signed' && laterSigned.length > 0
    ? laterSigned.map((s: any) => s.signatory_name || s.signatory_email).join(', ')
    : null

  // Mark opened when the assigned signatory first views it.
  if (isMine && t.status === 'sent') {
    await db.from('signoff_tasks').update({ status: 'opened', updated_at: new Date().toISOString() }).eq('id', taskId)
    t.status = 'opened'
  }

  const dv = ((batch as any)?.document_versions ?? [])[0]
  const myImage = isMine ? await signatureFor(user.email) : null
  return NextResponse.json({
    task: t,
    batch: { id: (batch as any)?.id, internal_ref: (batch as any)?.internal_ref, status: (batch as any)?.status, title: dv?.doc_name ?? dv?.file_name },
    isMine, canSign, canWithdraw, withdrawBlockedBy,
    signatoryName: profile?.full_name ?? user.email,
    hasSignature: !!myImage,
    signatureImage: myImage,
    waitingOn: earlierOpen.length > 0,
  })
}
