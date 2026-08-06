/**
 * Shared import processing for SharePoint data → Supabase.
 *
 * Used by:
 *   - POST /api/admin/import          (manual CSV upload)
 *   - POST /api/admin/sync-sharepoint (manual "Sync now" — reads lists via Graph)
 *   - GET  /api/cron/sharepoint-sync  (daily automatic sync)
 *
 * The row shape is identical across all three: keys are the SharePoint list column
 * names (DocUniqueId, Title, ApproverEmail, ReviewOutcomeCode, …). The Graph reader
 * coerces booleans to 'True'/'False' so this logic is source-agnostic.
 */

export type ImportSource = 'approver_picks' | 'document_approval_list'

export interface ImportResult {
  status: string
  records_scanned: number
  records_created: number
  records_updated: number
  records_failed: number
  error_log: string | null
}

export async function processImport(
  runId: string, source: string, mode: string, rows: any[], db: any,
): Promise<ImportResult> {
  const isDryRun = mode === 'dry_run'
  const errors: string[] = []
  let created = 0, updated = 0, failed = 0

  try {
    if (source === 'approver_picks') {
      const r = await importApproverPicks(rows, isDryRun, db, errors)
      created = r.created; updated = r.updated; failed = r.failed
    } else if (source === 'document_approval_list') {
      const r = await importApprovalList(rows, isDryRun, db, errors)
      created = r.created; updated = r.updated; failed = r.failed
    }

    const status = failed > 0 ? 'partial' : 'completed'
    const result: ImportResult = {
      status, records_scanned: rows.length, records_created: created,
      records_updated: updated, records_failed: failed,
      error_log: errors.length > 0 ? errors.slice(0, 50).join('\n') : null,
    }
    if (runId) await db.from('import_runs').update({ ...result, completed_at: new Date().toISOString() }).eq('id', runId)
    return result
  } catch (e: any) {
    if (runId) await db.from('import_runs').update({
      status: 'failed', completed_at: new Date().toISOString(), error_log: e.message,
    }).eq('id', runId)
    return { status: 'failed', error_log: e.message, records_scanned: rows.length,
             records_created: created, records_updated: updated, records_failed: failed }
  }
}

// ─── APPROVER PICKS ──────────────────────────────────────────────────────────
async function importApproverPicks(rows: any[], isDryRun: boolean, db: any, errors: string[]) {
  let created = 0, updated = 0, failed = 0

  const vendorMap = new Map<string, string>()
  const vendorUpserts: any[] = []
  const seenCodes = new Set<string>()
  for (const row of rows) {
    const code = extractVendorCode(row['SourceSiteURL'] ?? '')
    if (code && !seenCodes.has(code)) { seenCodes.add(code); vendorUpserts.push({ code, name: code, active: true }) }
  }
  if (!isDryRun && vendorUpserts.length > 0) {
    const { data: vendors } = await db.from('vendors').upsert(vendorUpserts, { onConflict: 'code' }).select('id, code')
    vendors?.forEach((v: any) => vendorMap.set(v.code, v.id))
  }

  const batchUpserts: any[] = []
  const seenBatchGuids = new Set<string>()
  for (const row of rows) {
    try {
      const batchGuid = row['DocUniqueId'] ?? row['BatchID'] ?? null
      if (!batchGuid) { failed++; errors.push(`Row missing BatchID: ${row['Title']?.slice(0, 40)}`); continue }
      if (seenBatchGuids.has(batchGuid)) continue
      seenBatchGuids.add(batchGuid)

      const readyToStart   = row['ReadyToStart'] === 'True'
      const rejectReq      = row['RejectRequested'] === 'True'
      const returnComplete = row['ReturnComplete'] === 'True'
      let status = 'intake_received'
      if (rejectReq)           status = 'rejected_before_review'
      else if (returnComplete) status = 'returned_to_vendor'
      else if (readyToStart)   status = 'review_in_progress'

      const vendorCode = extractVendorCode(row['SourceSiteURL'] ?? '')
      const vendorId = vendorMap.get(vendorCode ?? '') ?? null

      batchUpserts.push({
        batch_guid: batchGuid, vendor_id: vendorId, source_site_url: row['SourceSiteURL'] ?? null,
        status, file_count: 1, vendor_email: row['VendorEmail'] ?? null, comments: row['Comments'] ?? null,
        reject_reason: row['VendorRejectReason'] ?? null,
        received_at: parseDate(row['BatchReceivedDate']) ?? new Date().toISOString(),
        returned_at: returnComplete ? parseDate(row['BatchReturnedToVendorDate']) : null,
        rejected_at: rejectReq ? new Date().toISOString() : null,
      })
    } catch (e: any) { failed++; errors.push(`Row error: ${e.message}`) }
  }

  if (!isDryRun && batchUpserts.length > 0) {
    for (let i = 0; i < batchUpserts.length; i += 100) {
      const chunk = batchUpserts.slice(i, i + 100)
      const { error } = await db.from('batches').upsert(chunk, { onConflict: 'batch_guid' })
      if (error) { failed += chunk.length; errors.push(`Batch upsert error: ${error.message}`) } else created += chunk.length
    }
  } else { created = batchUpserts.length }

  return { created, updated, failed }
}

// ─── DOCUMENT APPROVAL LIST ──────────────────────────────────────────────────
async function importApprovalList(rows: any[], isDryRun: boolean, db: any, errors: string[]) {
  let created = 0, updated = 0, failed = 0
  const dvUpserts: any[] = []
  const rtUpserts: any[] = []
  const seenDocUniqueIds = new Set<string>()
  const seenRtKeys = new Set<string>()

  for (const row of rows) {
    try {
      const docUniqueId = row['DocUniqueId']
      if (!docUniqueId) { failed++; continue }
      const fileName = (row['Title'] ?? '').trim()
      const { revision } = parseFileName(fileName)

      if (!seenDocUniqueIds.has(docUniqueId)) {
        seenDocUniqueIds.add(docUniqueId)
        dvUpserts.push({
          doc_unique_id: docUniqueId, file_name: fileName || docUniqueId, revision, revision_sort: revision ?? 'A',
          doc_name: row['DocName'] ?? null, discipline: row['Discipline'] ?? null,
          document_type: row['DocumentType'] ?? null, topic: row['Topic'] ?? null, ai_text: row['AIText'] ?? null,
          central_file_url: row['DocUrl'] ?? null,
          status: row['ReviewComplete'] === 'True' ? 'review_complete' : 'under_review',
          is_latest: true, storage_provider: 'sharepoint',
          uploaded_at: parseDate(row['DateReceiveBatch']) ?? new Date().toISOString(),
          returned_at: parseDate(row['LastReturnedToVendorDate']),
        })
      }

      const reviewerEmail = (row['ApproverEmail'] ?? '').trim()
      const seqNum = parseInt(row['SequenceNumber'] ?? '1', 10) || 1
      const rtKey = `${docUniqueId}||${reviewerEmail}||${seqNum}`
      if (reviewerEmail && !seenRtKeys.has(rtKey)) {
        seenRtKeys.add(rtKey)
        rtUpserts.push({
          reviewer_email: reviewerEmail, sequence_number: seqNum,
          status: row['ReviewComplete'] === 'True' ? 'completed' : 'pending',
          date_sent: parseDate(row['ReviewerDateSent']), date_completed: parseDate(row['ReviewerDateCompleted']),
          review_outcome_code: mapOutcomeCode(row['ReviewOutcomeCode']), review_outcome_text: row['ReviewOutcomeText'] ?? null,
          comment: row['Comment'] ?? null, markup_summary: row['MarkupSummary'] ?? null,
          markup_status: row['MarkupStatus'] ? 'done' : 'not_started',
          is_manager_override: row['ManagerOverride'] === 'True', manager_override_by: row['ManagerOverrideBy'] ?? null,
          _doc_unique_id: docUniqueId,
        })
      }
    } catch (e: any) { failed++; errors.push(`Row error: ${e.message}`) }
  }

  if (!isDryRun) {
    for (let i = 0; i < dvUpserts.length; i += 50) {
      const chunk = dvUpserts.slice(i, i + 50)
      const { data, error } = await db.from('document_versions')
        .upsert(chunk, { onConflict: 'doc_unique_id', ignoreDuplicates: false }).select('id, doc_unique_id')
      if (error) { failed += chunk.length; errors.push(`DocVersion upsert [${i}-${i + chunk.length}]: ${error.message}`) }
      else created += data?.length ?? chunk.length
    }
    const allDocUniqueIds = [...seenDocUniqueIds]
    const dvIdMap = new Map<string, string>()
    for (let i = 0; i < allDocUniqueIds.length; i += 200) {
      const chunk = allDocUniqueIds.slice(i, i + 200)
      const { data: dvRows } = await db.from('document_versions').select('id, doc_unique_id').in('doc_unique_id', chunk)
      dvRows?.forEach((dv: any) => dvIdMap.set(dv.doc_unique_id, dv.id))
    }
    let rtFinal = rtUpserts.map(rt => {
      const dvId = dvIdMap.get(rt._doc_unique_id)
      if (!dvId) return null
      const { _doc_unique_id, ...rest } = rt
      return { ...rest, document_version_id: dvId }
    }).filter(Boolean)

    // ── Guard (2026-08-06): never overlay the legacy SharePoint reviewer chain onto
    // a document the CoreDocs app already manages. App-created review_tasks carry a
    // batch_id; importer rows do not. Once a reviewer is added in-app the chain is
    // re-sequenced, but the SharePoint Approval List still holds the ORIGINAL sequence
    // numbers — re-importing them either injects phantom duplicate reviewers (which
    // block the live reviewer via the turn-order guard) or demotes an active task back
    // to 'pending'/clears its date_sent. Yolandi's E-Rooms deadlock was exactly this.
    // So: drop importer review_tasks for any document that has app-owned tasks. Legacy
    // parallel-run docs (no app chain) still import unchanged.
    let skippedAppOwned = 0
    if (rtFinal.length) {
      const dvIds = [...new Set(rtFinal.map((rt: any) => rt.document_version_id))]
      const appOwned = new Set<string>()
      for (let i = 0; i < dvIds.length; i += 200) {
        const chunk = dvIds.slice(i, i + 200)
        const { data: owned } = await db.from('review_tasks')
          .select('document_version_id').not('batch_id', 'is', null).in('document_version_id', chunk)
        owned?.forEach((r: any) => appOwned.add(r.document_version_id))
      }
      if (appOwned.size) {
        const before = rtFinal.length
        rtFinal = rtFinal.filter((rt: any) => !appOwned.has(rt.document_version_id))
        skippedAppOwned = before - rtFinal.length
        if (skippedAppOwned) errors.push(`Skipped ${skippedAppOwned} SharePoint review-task rows for ${appOwned.size} app-managed document(s) (CoreDocs owns the live chain).`)
      }
    }

    for (let i = 0; i < rtFinal.length; i += 100) {
      const chunk = rtFinal.slice(i, i + 100)
      const { error } = await db.from('review_tasks')
        .upsert(chunk, { onConflict: 'document_version_id,reviewer_email,sequence_number', ignoreDuplicates: false })
      if (error) errors.push(`ReviewTask upsert: ${error.message}`); else created += chunk.length
    }
  } else { created = dvUpserts.length + rtUpserts.length }

  return { created, updated, failed }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function extractVendorCode(siteUrl: string): string | null {
  const match = siteUrl.match(/\/sites\/([A-Z][A-Z0-9]+)/i)
  return match?.[1]?.split('-')[0]?.toUpperCase() ?? null
}
function parseFileName(fileName: string): { revision: string | null } {
  const withoutExt = fileName.replace(/\.[^.]+$/, '').trim()
  const match = withoutExt.match(/^(.+)_([A-Z0-9]{1,4})$/)
  return { revision: match ? match[2] : null }
}
function parseDate(val: string | undefined | null): string | null {
  if (!val) return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function mapOutcomeCode(val: string | undefined | null): string | null {
  if (!val) return null
  const valid = ['A1', 'B1', 'B2', 'C1', 'D1', 'Q1', 'V1', 'S1']
  const upper = val.trim().toUpperCase()
  return valid.includes(upper) ? upper : null
}
