/**
 * POST /api/intake/webhook
 *
 * Two modes:
 *
 * MODE A — Enriched payload from la-intake-core (source = "la-intake-core")
 *   la-intake-core has already:
 *   - Copied the file to the DocumentControl bucket
 *   - Run OCR and AI classification
 *   - Created the Approver Picks row in SharePoint
 *   - Emailed the controller
 *   The webhook only needs to create database records.
 *   No file copy, no OCR, no AI, no duplicate email.
 *
 * MODE B — Direct webhook call (no source field, future standalone operation)
 *   Webhook handles everything: file copy, OCR, AI, DB records, email.
 *   Used when la-intake-core is fully retired.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { getSiteId, graphFetch } from '@/lib/services/graph'

/**
 * Fetch document metadata (DocName, Discipline, etc.) for a single file
 * from a SharePoint document library using its filename.
 * Used to enrich files 2+ in a multi-file batch where la-intake-core
 * only provides AI data for the first file.
 */
async function fetchDocMetadataFromLibrary(
  siteUrl: string,
  listId: string,
  fileName: string
): Promise<{ docName?: string; discipline?: string; documentType?: string; topic?: string; aiText?: string } | null> {
  try {
    const siteId = await getSiteId(siteUrl)
    const escaped = fileName.replace(/'/g, "''")
    const res = await graphFetch(
      `/sites/${siteId}/lists/${listId}/items?$filter=fields/FileLeafRef eq '${escaped}'&$expand=fields($select=DocName,Discipline,DocType,DocumentType,Topic,AIText)&$top=1`
    )
    if (!res.ok) return null
    const data = await res.json()
    const fields = data.value?.[0]?.fields
    if (!fields) return null
    return {
      docName:      fields.DocName      ?? undefined,
      discipline:   fields.Discipline   ?? undefined,
      documentType: fields.DocumentType ?? fields.DocType ?? undefined,
      topic:        fields.Topic        ?? undefined,
      aiText:       fields.AIText       ?? undefined,
    }
  } catch (e: any) {
    console.warn('fetchDocMetadataFromLibrary failed for', fileName, ':', e.message)
    return null
  }
}

export async function POST(req: Request) {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-intake-secret')
  if (secret !== process.env.INTAKE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { vendorKey, files, return: returnInfo, source } = body
  if (!vendorKey || !files?.length) {
    return NextResponse.json({ error: 'vendorKey and files are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const isFromLaIntakeCore = source === 'la-intake-core'

  // ─── Look up vendor / package ─────────────────────────────────────────────
  const { data: pkg } = await db
    .from('packages')
    .select('id, vendor_id, package_name, package_code, vendors(name, primary_contact_email)')
    .eq('package_code', vendorKey)
    .single()

  const packageName = (pkg as any)?.package_name ?? vendorKey
  const vendorName  = (pkg as any)?.vendors?.name ?? vendorKey

  // ─── Idempotency: skip if batch already exists ────────────────────────────
  const incomingBatchGuid = body.batchGuid ?? null
  if (incomingBatchGuid) {
    const { data: existing } = await db
      .from('batches')
      .select('id')
      .eq('batch_guid', incomingBatchGuid)
      .single()
    if (existing) {
      return NextResponse.json({ success: true, batchId: existing.id, duplicate: true }, { status: 200 })
    }
  }

  // Also check by first file's itemUniqueId
  if (!incomingBatchGuid && files[0]?.itemUniqueId) {
    const { data: existingDv } = await db
      .from('document_versions')
      .select('batch_id')
      .eq('doc_unique_id', files[0].itemUniqueId)
      .single()
    if (existingDv?.batch_id) {
      return NextResponse.json({ success: true, batchId: existingDv.batch_id, duplicate: true }, { status: 200 })
    }
  }

  // ─── Create batch record ──────────────────────────────────────────────────
  const batchGuid = incomingBatchGuid ?? randomUUID()
  const { data: batch, error: batchErr } = await db
    .from('batches')
    .insert({
      batch_guid:       batchGuid,
      vendor_id:        pkg?.vendor_id ?? null,
      package_id:       pkg?.id ?? null,
      source_site_url:  files[0]?.siteUrl ?? null,
      target_library:   returnInfo?.libraryPath ?? null,
      controller_email: returnInfo?.controllerEmail ?? null,
      status:           'intake_received',
      file_count:       files.length,
      received_at:      new Date().toISOString(),
    })
    .select()
    .single()

  if (batchErr || !batch) {
    console.error('Failed to create batch:', batchErr)
    return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 })
  }

  // ─── MODE A: Enriched payload from la-intake-core ─────────────────────────
  if (isFromLaIntakeCore) {
    const {
      docUniqueId, docUrl, aiText, docName,
      discipline, documentType, topic, batchDocumentIds,
      approverPicksId  // SharePoint item ID of the Approver Picks row
    } = body

    // Store the SharePoint Approver Picks item ID so start-review can update it directly
    if (approverPicksId) {
      await db.from('batches').update({
        sp_approver_picks_id: String(approverPicksId),
        updated_at: new Date().toISOString(),
      }).eq('id', batch.id)
    }

    // la-intake-core processes the FIRST file with full AI. Additional files
    // in the batch get basic properties only. Create one document_version per file.
    const docIds = batchDocumentIds?.split(',').map((s: string) => s.trim()) ?? []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const parsed = parseDocumentFileName(file.fileName)

      // For the first file: use the enriched AI data and docUrl from la-intake-core
      // For additional files: construct the expected DocumentControl URL
      const isFirst = i === 0
      const fileDocUrl = isFirst
        ? docUrl
        : (returnInfo?.siteUrl && returnInfo?.libraryPath
            ? `${returnInfo.siteUrl}${returnInfo.libraryPath}/${encodeURIComponent(file.fileName)}`
            : null)

      // DocUniqueId from la-intake-core for first file; construct for others
      const fileDocUniqueId = isFirst
        ? docUniqueId
        : (docIds[i] ? `${vendorKey.toUpperCase().replace(/-/g,'')}-${docIds[i]}` : null)

      // For files 2+: fetch their metadata from the DocumentControl library
      // so DocName/Discipline/etc. are populated for every document, not just the first.
      let extraMeta: Awaited<ReturnType<typeof fetchDocMetadataFromLibrary>> = null
      if (!isFirst && returnInfo?.siteUrl && returnInfo?.listId) {
        extraMeta = await fetchDocMetadataFromLibrary(
          returnInfo.siteUrl, returnInfo.listId, file.fileName
        )
      }

      await db.from('document_versions').upsert({
        batch_id:          batch.id,
        file_name:         file.fileName,
        revision:          parsed.revision,
        revision_sort:     parsed.revisionSort ?? parsed.revision,
        source_site_url:   file.siteUrl,
        source_file_url:   file.fileServerRelativeUrl,
        central_file_url:  fileDocUrl,
        doc_unique_id:     fileDocUniqueId ?? file.itemUniqueId,
        storage_provider:  'sharepoint',
        ai_text:           isFirst ? (aiText ?? null) : (extraMeta?.aiText ?? null),
        doc_name:          isFirst ? (docName ?? null) : (extraMeta?.docName ?? null),
        discipline:        isFirst ? (discipline ?? null) : (extraMeta?.discipline ?? null),
        document_type:     isFirst ? (documentType ?? null) : (extraMeta?.documentType ?? null),
        topic:             isFirst ? (topic ?? null) : (extraMeta?.topic ?? null),
        ai_metadata_source: 'ai',
        status:            'uploaded',
        is_latest:         true,
      }, { onConflict: 'doc_unique_id', ignoreDuplicates: false })
    }

    // Audit event
    await db.from('audit_events').insert({
      entity_type: 'batch',
      entity_id:   batch.id,
      event_type:  'intake_received_from_la_intake_core',
      actor_email: 'system_la_intake_core',
      event_data:  { vendorKey, fileCount: files.length, batchGuid, docUniqueId, docUrl },
    })

    // Update batch status to metadata_pending (AI is already done)
    await db.from('batches').update({
      status:     'metadata_pending',
      updated_at: new Date().toISOString(),
    }).eq('id', batch.id)

    return NextResponse.json({
      success:  true,
      batchId:  batch.id,
      batchGuid,
      mode:     'la-intake-core',
    }, { status: 201 })
  }

  // ─── MODE B: Direct webhook (standalone, no la-intake-core) ───────────────
  // File copy + OCR + AI handled here. Used when la-intake-core is retired.
  // For parallel operation, this path should not be triggered — la-intake-core
  // handles K108 and all other packages, then calls this webhook with enriched data.

  // Set central_file_url to the expected DocumentControl location immediately
  // (la-intake-core will have placed the file there before calling us)
  const auditErrors: string[] = []

  for (const file of files) {
    const parsed = parseDocumentFileName(file.fileName)
    const expectedDocControlUrl = returnInfo?.siteUrl && returnInfo?.libraryPath
      ? `${returnInfo.siteUrl}${returnInfo.libraryPath}/${encodeURIComponent(file.fileName)}`
      : null

    await db.from('document_versions').insert({
      batch_id:          batch.id,
      file_name:         file.fileName,
      revision:          parsed.revision,
      revision_sort:     parsed.revisionSort ?? parsed.revision,
      source_site_url:   file.siteUrl,
      source_file_url:   file.fileServerRelativeUrl,
      central_file_url:  expectedDocControlUrl,
      doc_unique_id:     file.itemUniqueId,
      storage_provider:  'sharepoint',
      status:            'uploaded',
      is_latest:         true,
    })
  }

  await db.from('audit_events').insert({
    entity_type: 'batch',
    entity_id:   batch.id,
    event_type:  'intake_received_direct',
    actor_email: 'system_webhook',
    event_data:  { vendorKey, fileCount: files.length, batchGuid, errors: auditErrors },
  })

  return NextResponse.json({
    success:  true,
    batchId:  batch.id,
    batchGuid,
    mode:     'direct',
  }, { status: 201 })
}
