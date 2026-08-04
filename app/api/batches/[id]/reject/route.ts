/**
 * POST /api/batches/[id]/reject
 *
 * Robust, server-orchestrated reject unwind. Runs in CoreDocs synchronously (no more
 * relying on the disconnected `va-intake-reject-batch` poller). Two modes:
 *
 *   • DRY RUN (default, body.commit !== true) — returns the exact MANIFEST of what a
 *     reject would remove/close/email, plus warnings. Nothing is changed.
 *   • COMMIT (body.commit === true) — performs the unwind in a fixed order, recording
 *     the manifest first, then each step idempotently:
 *        1. hard-delete the PPE "Documents for Approval" bucket copies
 *        2. hard-delete the vendor FROM VENDOR copies (so a corrected re-upload
 *           re-triggers intake)
 *        3. soft-close the Approver Picks row (mark not-ready + reason; not deleted)
 *        4. email the vendor
 *     Per-step success is stored on the batch (reject_*_deleted / _closed / _notified),
 *     so a partially-failed reject can be RETRIED (call commit again) and only the
 *     unfinished steps re-run. Hard-delete is safe to retry: already-gone == success.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { sendEmail, deleteDriveItemByUrl, deleteFileBySiteAndPath } from '@/lib/services/graph'
import { closeApproverPicksRow } from '@/lib/services/sharepoint-lists'
import { batchRejectedEmail } from '@/lib/services/email-templates'
import { logActivity } from '@/lib/activity'

const REJECTABLE = ['intake_received', 'metadata_pending', 'ready_for_reviewer_assignment']

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, email, full_name')
    .eq('auth_user_id', user.id).single()
  const __perms = await getPermissions(supabase)
  if (!can(__perms, FK.ACTION_REJECT_BATCH, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({} as any))
  const commit = body.commit === true
  const rejectReason = (body.rejectReason ?? '').trim()

  const db = createServiceClient()
  const { data: batch } = await db.from('batches')
    .select(`
      id, batch_guid, status, vendor_email, controller_email, sp_approver_picks_id,
      reject_reason, reject_bucket_deleted, reject_source_deleted, reject_picks_closed, reject_vendor_notified,
      packages(package_name, package_code),
      document_versions(file_name, central_file_url, source_site_url, source_file_url, doc_unique_id)
    `).eq('id', id).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const b = batch as any
  const alreadyRejected = b.status === 'rejected_before_review'

  // Eligibility / race guard — only reject before review, or resume a prior reject's cleanup.
  if (!alreadyRejected && !REJECTABLE.includes(b.status)) {
    return NextResponse.json(
      { error: `This batch can no longer be rejected before review (status: ${b.status}).` },
      { status: 400 }
    )
  }

  const docs: any[] = b.document_versions ?? []
  const bucketFiles = docs.filter(d => d.central_file_url).map(d => ({ fileName: d.file_name, url: d.central_file_url as string }))
  const vendorFiles = docs.filter(d => d.source_site_url && d.source_file_url)
    .map(d => ({ fileName: d.file_name, siteUrl: d.source_site_url as string, path: d.source_file_url as string }))
  const pkgName = b.packages?.package_name ?? b.packages?.package_code ?? 'Unknown'

  const warnings: string[] = []
  if (!b.vendor_email) warnings.push('No vendor email recorded — the rejection notice cannot be emailed automatically.')
  if (bucketFiles.length === 0) warnings.push('No PPE bucket file URLs recorded — nothing to delete from the approval library.')
  if (vendorFiles.length === 0) warnings.push('No vendor source-file references recorded — the FROM VENDOR copy cannot be auto-removed; the vendor must delete it before re-uploading.')
  if (!b.sp_approver_picks_id) warnings.push('No stored Approver Picks row id — it will be located by batch GUID, or skipped if this was a new-app-only batch.')

  const manifest = {
    package: pkgName,
    bucketFiles,
    vendorFiles,
    approverPicksRow: b.sp_approver_picks_id ? `item ${b.sp_approver_picks_id}` : 'locate by batch GUID',
    vendorEmail: b.vendor_email ?? null,
    reason: alreadyRejected ? b.reject_reason : (rejectReason || null),
  }

  // ─── DRY RUN (default) ──────────────────────────────────────────────────────
  if (!commit) {
    return NextResponse.json({ preview: true, alreadyRejected, manifest, warnings })
  }

  // ─── COMMIT ─────────────────────────────────────────────────────────────────
  const effectiveReason = alreadyRejected ? (b.reject_reason ?? rejectReason) : rejectReason
  if (!effectiveReason) return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 })

  const now = new Date().toISOString()

  // Mark rejected + record the manifest (first commit only) — so the "what was here"
  // record survives the hard-delete.
  if (!alreadyRejected) {
    await db.from('batches').update({
      status: 'rejected_before_review', reject_reason: effectiveReason, rejected_at: now, updated_at: now,
    }).eq('id', id)
    await db.from('audit_events').insert({
      entity_type: 'batch', entity_id: id, event_type: 'rejected_before_review',
      actor_user_id: null, actor_email: profile?.email,
      event_data: { rejectReason: effectiveReason, rejectedBy: profile?.full_name, manifest },
    })
    await logActivity({ area: 'batches', action: 'batch.reject', targetType: 'batch', targetId: id, summary: effectiveReason, email: profile?.email })
  }

  const steps: Record<string, string> = {}
  const errs: string[] = []

  // 1 ── Hard-delete PPE bucket copies
  let bucketDone = !!b.reject_bucket_deleted
  if (bucketDone) steps.bucket = 'already'
  else {
    const results = await Promise.all(bucketFiles.map(f => deleteDriveItemByUrl(f.url)))
    const failed = results.filter(r => !r.ok)
    if (failed.length === 0) { bucketDone = true; steps.bucket = bucketFiles.length ? 'done' : 'skipped' }
    else { steps.bucket = 'error'; errs.push(`Bucket delete: ${failed.map(f => f.detail).join('; ')}`) }
  }

  // 2 ── Hard-delete vendor FROM VENDOR copies
  let sourceDone = !!b.reject_source_deleted
  if (sourceDone) steps.source = 'already'
  else if (vendorFiles.length === 0) { sourceDone = true; steps.source = 'skipped' }
  else {
    const results = await Promise.all(vendorFiles.map(f => deleteFileBySiteAndPath(f.siteUrl, f.path)))
    const failed = results.filter(r => !r.ok)
    if (failed.length === 0) { sourceDone = true; steps.source = 'done' }
    else { steps.source = 'error'; errs.push(`Vendor copy delete: ${failed.map(f => f.detail).join('; ')}`) }
  }

  // 3 ── Soft-close the Approver Picks row
  let picksDone = !!b.reject_picks_closed
  if (picksDone) steps.picks = 'already'
  else {
    const r = await closeApproverPicksRow({ spItemId: b.sp_approver_picks_id, batchGuid: b.batch_guid, reason: effectiveReason })
    if (r.ok) { picksDone = true; steps.picks = r.found ? 'done' : 'skipped' }
    else { steps.picks = 'error'; errs.push(`Approver Picks: ${r.error}`) }
  }

  // 4 ── Email the vendor
  let emailDone = !!b.reject_vendor_notified
  if (emailDone) steps.email = 'already'
  else if (!b.vendor_email) steps.email = 'skipped'   // no address — leave un-notified so a later fix + retry can send
  else {
    try {
      const html = batchRejectedEmail({
        packageName: pkgName,
        vendorCode: b.packages?.package_code ?? '',
        fileNames: docs.map(d => d.file_name),
        rejectReason: effectiveReason,
        controllerEmail: profile?.email ?? b.controller_email ?? '',
        sourceRemoved: sourceDone,
      })
      await sendEmail({
        to: String(b.vendor_email).split(/[;,]/).map((e: string) => e.trim()).filter(Boolean),
        cc: profile?.email ? [profile.email] : [],
        subject: `[Doc Control] Document batch rejected — ${pkgName}`,
        htmlBody: html,
      })
      emailDone = true; steps.email = 'done'
    } catch (e: any) {
      steps.email = 'error'; errs.push(`Email: ${e.message}`)
    }
  }

  const cleanupError = errs.length ? errs.join(' | ') : null
  await db.from('batches').update({
    reject_bucket_deleted: bucketDone,
    reject_source_deleted: sourceDone,
    reject_picks_closed: picksDone,
    reject_vendor_notified: emailDone,
    reject_cleanup_error: cleanupError,
    updated_at: now,
  }).eq('id', id)

  const complete = bucketDone && sourceDone && picksDone && (emailDone || !b.vendor_email)
  return NextResponse.json({ success: true, complete, steps, error: cleanupError, warnings })
}
