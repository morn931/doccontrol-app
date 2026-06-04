import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { mode, source, csvData } = body
  if (!csvData) return NextResponse.json({ error: 'csvData is required' }, { status: 400 })

  const db = createServiceClient()

  // Create import run record
  const { data: run } = await db.from('import_runs').insert({
    source, mode: mode ?? 'dry_run', started_by: null, status: 'running',
  }).select().single()

  if (!run) return NextResponse.json({ error: 'Failed to create import run' }, { status: 500 })

  // Process synchronously (bulk inserts are fast enough for <5000 rows)
  const result = await processImport(run.id, source, mode ?? 'dry_run', csvData, db)

  return NextResponse.json({ runId: run.id, ...result }, { status: 200 })
}

async function processImport(runId: string, source: string, mode: string, csvData: any[], db: any) {
  const isDryRun = mode === 'dry_run'
  const errors: string[] = []
  let created = 0, updated = 0, failed = 0

  try {
    if (source === 'approver_picks') {
      const result = await importApproverPicks(csvData, isDryRun, db, errors)
      created = result.created; updated = result.updated; failed = result.failed
    } else if (source === 'document_approval_list') {
      const result = await importApprovalList(csvData, isDryRun, db, errors)
      created = result.created; updated = result.updated; failed = result.failed
    }

    const status = failed > 0 ? 'partial' : 'completed'
    await db.from('import_runs').update({
      status, completed_at: new Date().toISOString(),
      records_scanned: csvData.length, records_created: created,
      records_updated: updated, records_failed: failed,
      error_log: errors.length > 0 ? errors.slice(0, 50).join('\n') : null,
    }).eq('id', runId)

    return { status, records_scanned: csvData.length, records_created: created,
             records_updated: updated, records_failed: failed,
             error_log: errors.length > 0 ? errors.slice(0, 50).join('\n') : null }

  } catch (e: any) {
    await db.from('import_runs').update({
      status: 'failed', completed_at: new Date().toISOString(), error_log: e.message
    }).eq('id', runId)
    return { status: 'failed', error_log: e.message,
             records_scanned: csvData.length, records_created: created,
             records_updated: updated, records_failed: failed }
  }
}

// ─── APPROVER PICKS IMPORT ───────────────────────────────────────────────────
async function importApproverPicks(rows: any[], isDryRun: boolean, db: any, errors: string[]) {
  let created = 0, updated = 0, failed = 0

  // Collect unique vendor codes
  const vendorMap = new Map<string, string>() // code -> id
  const vendorUpserts: any[] = []
  const seenCodes = new Set<string>()

  for (const row of rows) {
    const code = extractVendorCode(row['SourceSiteURL'] ?? '')
    if (code && !seenCodes.has(code)) {
      seenCodes.add(code)
      vendorUpserts.push({ code, name: code, active: true })
    }
  }

  if (!isDryRun && vendorUpserts.length > 0) {
    const { data: vendors } = await db.from('vendors')
      .upsert(vendorUpserts, { onConflict: 'code' }).select('id, code')
    vendors?.forEach((v: any) => vendorMap.set(v.code, v.id))
  }

  // Build batch upserts — deduplicate by batch_guid
  const batchUpserts: any[] = []
  const seenBatchGuids = new Set<string>()
  for (const row of rows) {
    try {
      // Use DocUniqueId (K137-format string) as the batch_guid — this matches document_versions.doc_unique_id
      const batchGuid = row['DocUniqueId'] ?? row['BatchID'] ?? null
      if (!batchGuid) { failed++; errors.push(`Row missing BatchID: ${row['Title']?.slice(0,40)}`); continue }
      if (seenBatchGuids.has(batchGuid)) continue  // skip duplicates within same CSV
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
        batch_guid:      batchGuid,
        vendor_id:       vendorId,
        source_site_url: row['SourceSiteURL'] ?? null,
        status,
        file_count:      1,
        vendor_email:    row['VendorEmail'] ?? null,
        comments:        row['Comments'] ?? null,
        reject_reason:   row['VendorRejectReason'] ?? null,
        received_at:     parseDate(row['BatchReceivedDate']) ?? new Date().toISOString(),
        returned_at:     returnComplete ? parseDate(row['BatchReturnedToVendorDate']) : null,
        rejected_at:     rejectReq ? new Date().toISOString() : null,
      })
    } catch (e: any) {
      failed++
      errors.push(`Row error: ${e.message}`)
    }
  }

  if (!isDryRun && batchUpserts.length > 0) {
    // Upsert in chunks of 100
    for (let i = 0; i < batchUpserts.length; i += 100) {
      const chunk = batchUpserts.slice(i, i + 100)
      const { error } = await db.from('batches').upsert(chunk, { onConflict: 'batch_guid' })
      if (error) { failed += chunk.length; errors.push(`Batch upsert error: ${error.message}`) }
      else created += chunk.length
    }
  } else {
    created = batchUpserts.length
  }

  return { created, updated, failed }
}

// ─── DOCUMENT APPROVAL LIST IMPORT ──────────────────────────────────────────
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
      const { normalizedDocumentNumber, revision } = parseFileName(fileName)

      // One document_version per unique DocUniqueId
      if (!seenDocUniqueIds.has(docUniqueId)) {
        seenDocUniqueIds.add(docUniqueId)
        dvUpserts.push({
          doc_unique_id:    docUniqueId,
          file_name:        fileName || docUniqueId,
          revision:         revision,
          revision_sort:    revision ?? 'A',
          doc_name:         row['DocName'] ?? null,
          discipline:       row['Discipline'] ?? null,
          document_type:    row['DocumentType'] ?? null,
          topic:            row['Topic'] ?? null,
          ai_text:          row['AIText'] ?? null,
          central_file_url: row['DocUrl'] ?? null,
          status:           row['ReviewComplete'] === 'True' ? 'review_complete' : 'under_review',
          is_latest:        true,
          storage_provider: 'sharepoint',
          uploaded_at:      parseDate(row['DateReceiveBatch']) ?? new Date().toISOString(),
          returned_at:      parseDate(row['LastReturnedToVendorDate']),
        })
      }

      // One review_task per row (each reviewer) — deduplicate by composite key
      const reviewerEmail = (row['ApproverEmail'] ?? '').trim()
      const seqNum = parseInt(row['SequenceNumber'] ?? '1', 10) || 1
      const rtKey = `${docUniqueId}||${reviewerEmail}||${seqNum}`
      if (reviewerEmail && !seenRtKeys.has(rtKey)) {
        seenRtKeys.add(rtKey)
        rtUpserts.push({
          reviewer_email:      reviewerEmail,
          sequence_number:     seqNum,
          status:              row['ReviewComplete'] === 'True' ? 'completed' : 'pending',
          date_sent:           parseDate(row['ReviewerDateSent']),
          date_completed:      parseDate(row['ReviewerDateCompleted']),
          review_outcome_code: mapOutcomeCode(row['ReviewOutcomeCode']),
          review_outcome_text: row['ReviewOutcomeText'] ?? null,
          comment:             row['Comment'] ?? null,
          markup_summary:      row['MarkupSummary'] ?? null,
          markup_status:       row['MarkupStatus'] ? 'done' : 'not_started',
          is_manager_override: row['ManagerOverride'] === 'True',
          manager_override_by: row['ManagerOverrideBy'] ?? null,
          _doc_unique_id:      docUniqueId,
        })
      }
    } catch (e: any) {
      failed++
      errors.push(`Row error: ${e.message}`)
    }
  }

  if (!isDryRun) {
    // Bulk upsert document_versions in chunks of 50 (smaller to avoid payload limits)
    for (let i = 0; i < dvUpserts.length; i += 50) {
      const chunk = dvUpserts.slice(i, i + 50)
      const { data, error } = await db.from('document_versions')
        .upsert(chunk, { onConflict: 'doc_unique_id', ignoreDuplicates: false })
        .select('id, doc_unique_id')
      if (error) {
        failed += chunk.length
        errors.push(`DocVersion upsert [chunk ${i}-${i+chunk.length}]: ${error.message} | code: ${error.code} | details: ${JSON.stringify(error.details)}`)
      } else {
        created += data?.length ?? chunk.length
      }
    }

    // Fetch all the doc version IDs we just upserted so we can link review tasks
    const allDocUniqueIds = [...seenDocUniqueIds]
    const dvIdMap = new Map<string, string>()
    for (let i = 0; i < allDocUniqueIds.length; i += 200) {
      const chunk = allDocUniqueIds.slice(i, i + 200)
      const { data: dvRows } = await db.from('document_versions')
        .select('id, doc_unique_id').in('doc_unique_id', chunk)
      dvRows?.forEach((dv: any) => dvIdMap.set(dv.doc_unique_id, dv.id))
    }

    // Bulk upsert review_tasks (linked by document_version_id)
    const rtFinal = rtUpserts
      .map(rt => {
        const dvId = dvIdMap.get(rt._doc_unique_id)
        if (!dvId) return null
        const { _doc_unique_id, ...rest } = rt
        return { ...rest, document_version_id: dvId }
      })
      .filter(Boolean)

    for (let i = 0; i < rtFinal.length; i += 100) {
      const chunk = rtFinal.slice(i, i + 100)
      const { error } = await db.from('review_tasks')
        .upsert(chunk, { onConflict: 'document_version_id,reviewer_email,sequence_number',
                         ignoreDuplicates: false })
      if (error) errors.push(`ReviewTask upsert: ${error.message}`)
      else created += chunk.length
    }
  } else {
    created = dvUpserts.length + rtUpserts.length
  }

  return { created, updated, failed }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function extractVendorCode(siteUrl: string): string | null {
  const match = siteUrl.match(/\/sites\/([A-Z][A-Z0-9]+)/i)
  return match?.[1]?.split('-')[0]?.toUpperCase() ?? null
}

function parseFileName(fileName: string): { normalizedDocumentNumber: string | null; revision: string | null } {
  const withoutExt = fileName.replace(/\.[^.]+$/, '').trim()
  const match = withoutExt.match(/^(.+)_([A-Z0-9]{1,4})$/)
  if (match) return { normalizedDocumentNumber: match[1], revision: match[2] }
  return { normalizedDocumentNumber: withoutExt || null, revision: null }
}

function parseDate(val: string | undefined | null): string | null {
  if (!val) return null
  try {
    const d = new Date(val)
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch { return null }
}

function mapOutcomeCode(val: string | undefined | null): string | null {
  if (!val) return null
  const valid = ['A1','B1','B2','C1','D1','Q1','V1','S1']
  const upper = val.trim().toUpperCase()
  return valid.includes(upper) ? upper : null
}
