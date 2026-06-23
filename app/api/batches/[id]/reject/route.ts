import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { batchRejectedEmail } from '@/lib/services/email-templates'
import { logActivity } from '@/lib/activity'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, email, full_name')
    .eq('auth_user_id', user.id).single()
  if (!['admin','document_controller'].includes(profile?.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { rejectReason } = body

  if (!rejectReason?.trim()) {
    return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 })
  }

  const db = createServiceClient()

  // Get batch details
  const { data: batch } = await db.from('batches')
    .select('id, batch_guid, status, vendor_email, controller_email, packages(package_name, package_code), document_versions(file_name)')
    .eq('id', id).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Prevent double-rejection
  if (batch.status === 'rejected_before_review') {
    return NextResponse.json({ error: 'Batch already rejected' }, { status: 400 })
  }

  // Update batch status
  await db.from('batches').update({
    status:       'rejected_before_review',
    reject_reason: rejectReason.trim(),
    rejected_at:  new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  }).eq('id', id)

  // Audit event
  await db.from('audit_events').insert({
    entity_type:   'batch',
    entity_id:     id,
    event_type:    'rejected_before_review',
    actor_user_id: null,
    actor_email:   profile?.email,
    event_data:    { rejectReason, rejectedBy: profile?.full_name },
  })

  await logActivity({ area: 'batches', action: 'batch.reject', targetType: 'batch', targetId: id, summary: rejectReason.trim(), email: profile?.email })

  // Send rejection email to vendor
  const vendorEmail = batch.vendor_email
  if (vendorEmail) {
    try {
      const pkgName = (batch.packages as any)?.package_name ?? (batch.packages as any)?.package_code ?? 'Unknown'
      const fileNames = ((batch.document_versions as any[]) ?? []).map((dv: any) => dv.file_name)
      const html = batchRejectedEmail({
        packageName:     pkgName,
        vendorCode:      (batch.packages as any)?.package_code ?? '',
        fileNames,
        rejectReason:    rejectReason.trim(),
        controllerEmail: profile?.email ?? batch.controller_email ?? '',
      })
      await sendEmail({
        to:       vendorEmail.split(/[;,]/).map((e: string) => e.trim()).filter(Boolean),
        cc:       profile?.email ? [profile.email] : [],
        subject:  `[Doc Control] Document batch rejected — ${pkgName}`,
        htmlBody: html,
      })
    } catch (emailErr: any) {
      // Log but don't fail the request
      console.error('Rejection email failed:', emailErr.message)
    }
  }

  return NextResponse.json({ success: true })
}
