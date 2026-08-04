/**
 * POST /api/batches/[id]/reject
 *
 * Robust, server-orchestrated reject unwind — synchronous, in-app (no reliance on the
 * disconnected `va-intake-reject-batch` poller). Works per DOCUMENT:
 *
 *   • body.documentVersionIds = [..]  → reject only those documents; the batch stays
 *     OPEN for its remaining good documents.
 *   • omitted  → reject every still-active document (whole batch).
 *   • Rejecting the LAST active document auto-escalates to a full-batch reject
 *     (close the Approver Picks row + mark the batch rejected_before_review).
 *
 * Two modes:
 *   • DRY RUN (default, body.commit !== true) — returns the MANIFEST of what the
 *     selected reject would remove/close/email, plus warnings. Nothing changes.
 *   • COMMIT (body.commit === true) — for each targeted document, in order:
 *        1. hard-delete its PPE "Documents for Approval" bucket copy
 *        2. hard-delete its vendor FROM VENDOR copy (so a corrected re-upload
 *           re-triggers intake as a fresh batch)
 *      then, if the batch is now fully rejected: soft-close the Approver Picks row +
 *      mark the batch rejected. Finally, email the vendor the rejected files.
 *
 * Per-document success is stored (document_versions.reject_bucket_deleted /
 * _source_deleted / is_rejected), so a partial failure can be RETRIED and only the
 * unfinished work re-runs. Hard-delete is idempotent: already-gone == success.
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
  const vendorEmailOverride = (body.vendorEmail ?? '').trim()   // controller-entered recipient
  const selectedIds: string[] | null =
    Array.isArray(body.documentVersionIds) && body.documentVersionIds.length
      ? body.documentVersionIds.map(String) : null

  const db = createServiceClient()
  const { data: batch } = await db.from('batches')
    .select(`
      id, batch_guid, status, vendor_email, controller_email, sp_approver_picks_id,
      reject_reason, reject_picks_closed, reject_vendor_notified,
      packages(package_name, package_code),
      vendors(primary_contact_email),
      document_versions(
        id, file_name, central_file_url, source_site_url, source_file_url, doc_unique_id,
        is_rejected, rejected_at, reject_reason, reject_bucket_deleted, reject_source_deleted
      )
    `).eq('id', id).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const b = batch as any
  const alreadyFullyRejected = b.status === 'rejected_before_review'

  // Eligibility / race guard — reject only before review (or resume a prior reject's cleanup).
  if (!alreadyFullyRejected && !REJECTABLE.includes(b.status)) {
    return NextResponse.json(
      { error: `This batch can no longer be rejected before review (status: ${b.status}).` },
      { status: 400 }
    )
  }

  const docs: any[] = b.document_versions ?? []
  // Target set: the selected documents, else every still-active document (whole batch).
  const targetDocs = selectedIds
    ? docs.filter(d => selectedIds.includes(String(d.id)))
    : docs.filter(d => !d.is_rejected)

  if (selectedIds && targetDocs.length === 0)
    return NextResponse.json({ error: 'None of the selected documents belong to this batch.' }, { status: 400 })
  if (targetDocs.length === 0)
    return NextResponse.json({ error: 'No documents to reject.' }, { status: 400 })

  // After this reject, will any active document remain? If not, it's a whole-batch reject.
  const remainingActive = docs.filter(d => !d.is_rejected && !targetDocs.some((t: any) => t.id === d.id))
  const wholeBatch = remainingActive.length === 0

  const pkgName = b.packages?.package_name ?? b.packages?.package_code ?? 'Unknown'
  const bucketFiles = targetDocs.filter(d => d.central_file_url).map(d => ({ fileName: d.file_name, url: d.central_file_url as string }))
  const vendorFiles = targetDocs.filter(d => d.source_site_url && d.source_file_url)
    .map(d => ({ fileName: d.file_name, siteUrl: d.source_site_url as string, path: d.source_file_url as string }))

  // Resolve the rejection-notice recipient: entered → batch → package-vendor contact.
  const batchVendorEmail = (b.vendor_email ?? '').trim()
  const fallbackVendorEmail = (b.vendors?.primary_contact_email ?? '').trim()
  const vendorEmail = vendorEmailOverride || batchVendorEmail || fallbackVendorEmail || ''
  const vendorEmailFromFallback = !vendorEmailOverride && !batchVendorEmail && !!fallbackVendorEmail

  const warnings: string[] = []
  if (!vendorEmail) warnings.push('No vendor email entered, on the batch, or on the package vendor — enter one to notify the vendor.')
  else if (vendorEmailFromFallback) warnings.push(`Batch has no vendor email — using the package vendor contact (${vendorEmail}).`)
  if (bucketFiles.length === 0) warnings.push('No PPE bucket file URLs recorded for the selected documents — nothing to delete from the approval library.')
  if (vendorFiles.length === 0) warnings.push('No vendor source-file references recorded — the FROM VENDOR copy cannot be auto-removed; the vendor must delete it before re-uploading.')
  if (wholeBatch && !b.sp_approver_picks_id) warnings.push('No stored Approver Picks row id — it will be located by batch GUID, or skipped if this was a new-app-only batch.')

  const manifest = {
    package: pkgName,
    scope: wholeBatch ? 'Whole batch' : `${targetDocs.length} of ${docs.length} documents (batch stays open)`,
    wholeBatch,
    documents: targetDocs.map((d: any) => d.file_name),
    bucketFiles,
    vendorFiles,
    approverPicksRow: wholeBatch
      ? (b.sp_approver_picks_id ? `item ${b.sp_approver_picks_id} → closed` : 'locate by batch GUID → closed')
      : 'left open (batch keeps its remaining documents)',
    vendorEmail: vendorEmail || null,
    vendorEmailFromFallback,
    reason: rejectReason || (targetDocs.find((d: any) => d.reject_reason)?.reject_reason ?? null),
  }

  // ─── DRY RUN (default) ──────────────────────────────────────────────────────
  if (!commit) {
    return NextResponse.json({ preview: true, wholeBatch, manifest, warnings })
  }

  // ─── COMMIT ─────────────────────────────────────────────────────────────────
  const newlyRejected = targetDocs.filter((d: any) => !d.is_rejected)
  const pureRetry = newlyRejected.length === 0
  const effectiveReason = rejectReason || (targetDocs.find((d: any) => d.reject_reason)?.reject_reason ?? '')
  if (!pureRetry && !rejectReason)
    return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 })

  const now = new Date().toISOString()
  const errs: string[] = []

  // Record what is about to be removed (survives the hard-delete) — first commit that
  // actually rejects new documents.
  if (newlyRejected.length > 0) {
    await db.from('audit_events').insert({
      entity_type: 'batch', entity_id: id,
      event_type: wholeBatch ? 'rejected_before_review' : 'documents_rejected',
      actor_user_id: null, actor_email: profile?.email,
      event_data: { rejectReason: effectiveReason, rejectedBy: profile?.full_name, wholeBatch, manifest },
    })
    await logActivity({
      area: 'batches', action: wholeBatch ? 'batch.reject' : 'batch.reject_documents',
      targetType: 'batch', targetId: id,
      summary: `${effectiveReason} (${targetDocs.length} doc${targetDocs.length === 1 ? '' : 's'})`,
      email: profile?.email,
    })
  }

  // ── Per-document hard-delete (bucket + vendor copy), idempotent ──────────────
  const docResults: any[] = []
  for (const d of targetDocs) {
    const dErrs: string[] = []

    let bDone = !!d.reject_bucket_deleted
    if (!bDone) {
      if (!d.central_file_url) bDone = true
      else {
        const r = await deleteDriveItemByUrl(d.central_file_url)
        if (r.ok) bDone = true; else dErrs.push(`bucket: ${r.detail}`)
      }
    }

    let sDone = !!d.reject_source_deleted
    if (!sDone) {
      if (!(d.source_site_url && d.source_file_url)) sDone = true
      else {
        const r = await deleteFileBySiteAndPath(d.source_site_url, d.source_file_url)
        if (r.ok) sDone = true; else dErrs.push(`vendor: ${r.detail}`)
      }
    }

    await db.from('document_versions').update({
      is_rejected: true,
      reject_reason: d.is_rejected ? d.reject_reason : effectiveReason,
      rejected_at: d.rejected_at ?? now,
      reject_bucket_deleted: bDone,
      reject_source_deleted: sDone,
    }).eq('id', d.id)

    docResults.push({ id: d.id, fileName: d.file_name, bucket: bDone, source: sDone, errors: dErrs })
    if (dErrs.length) errs.push(`${d.file_name}: ${dErrs.join(', ')}`)
  }

  const allBucketDone = docResults.every(r => r.bucket)
  const allSourceDone = docResults.every(r => r.source)

  // ── Whole-batch escalation: close Approver Picks + mark the batch rejected ────
  let picksDone = !!b.reject_picks_closed
  if (wholeBatch) {
    if (!picksDone) {
      const r = await closeApproverPicksRow({ spItemId: b.sp_approver_picks_id, batchGuid: b.batch_guid, reason: effectiveReason })
      if (r.ok) picksDone = true; else errs.push(`Approver Picks: ${r.error}`)
    }
    if (!alreadyFullyRejected) {
      await db.from('batches').update({
        status: 'rejected_before_review', reject_reason: effectiveReason, rejected_at: now, updated_at: now,
      }).eq('id', id)
    }
  }

  // ── Email the vendor the newly-rejected files (skip on pure cleanup retry) ────
  let emailDone = wholeBatch ? !!b.reject_vendor_notified : false
  const notifyDocs = newlyRejected.length ? newlyRejected : targetDocs
  if (emailDone) { /* already notified for this whole-batch reject */ }
  else if (newlyRejected.length === 0) { /* pure retry — nothing new to notify */ }
  else if (!vendorEmail) { /* no recipient — leave un-notified so a later fix + retry can send */ }
  else {
    try {
      const html = batchRejectedEmail({
        packageName: pkgName,
        vendorCode: b.packages?.package_code ?? '',
        fileNames: notifyDocs.map((d: any) => d.file_name),
        rejectReason: effectiveReason,
        controllerEmail: profile?.email ?? b.controller_email ?? '',
        sourceRemoved: docResults.filter(r => notifyDocs.some((d: any) => d.id === r.id)).every(r => r.source),
      })
      await sendEmail({
        to: vendorEmail.split(/[;,]/).map((e: string) => e.trim()).filter(Boolean),
        cc: profile?.email ? [profile.email] : [],
        subject: wholeBatch
          ? `[Doc Control] Document batch rejected — ${pkgName}`
          : `[Doc Control] Document(s) rejected — ${pkgName}`,
        htmlBody: html,
      })
      emailDone = true
    } catch (e: any) {
      errs.push(`Email: ${e.message}`)
    }
  }

  const cleanupError = errs.length ? errs.join(' | ') : null

  // Persist batch-level state. On a whole-batch reject this drives the batch cleanup
  // panel; on a partial reject the batch stays open and per-document flags are the
  // source of truth (an entered recipient is still saved for later notices).
  const finalUpdate: Record<string, any> = { updated_at: now }
  if (wholeBatch) {
    finalUpdate.reject_bucket_deleted = allBucketDone
    finalUpdate.reject_source_deleted = allSourceDone
    finalUpdate.reject_picks_closed = picksDone
    finalUpdate.reject_vendor_notified = emailDone
    finalUpdate.reject_cleanup_error = cleanupError
  }
  if (vendorEmailOverride && vendorEmailOverride !== batchVendorEmail) finalUpdate.vendor_email = vendorEmailOverride
  await db.from('batches').update(finalUpdate).eq('id', id)

  const complete = allBucketDone && allSourceDone &&
    (wholeBatch ? (picksDone && (emailDone || !vendorEmail)) : (emailDone || !vendorEmail || pureRetry))

  return NextResponse.json({ success: true, wholeBatch, complete, documents: docResults, error: cleanupError, warnings })
}
