/**
 * POST /api/intake/webhook
 * Receives new file upload notifications from SharePoint watcher Logic Apps.
 * Authenticated by X-Intake-Secret header.
 *
 * Body (compatible with existing Small Flow Logic App format):
 * {
 *   vendorKey: string,
 *   files: [{siteUrl, listId, fileServerRelativeUrl, fileName, itemUniqueId}],
 *   return: {siteUrl, libraryPath, listId, controllerEmail}
 * }
 *
 * Pipeline:
 * 1. Create batch record (idempotent — returns existing if already processed)
 * 2. For each file: copy to DocumentControl SharePoint library
 * 3. Run Azure Document Intelligence OCR on each file
 * 4. Run Azure OpenAI classification on extracted text
 * 5. Store metadata on document_version records
 * 6. Send controller notification email with AI summary
 */

import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { copyFileToDocControl, sendEmail, getGraphToken } from '@/lib/services/graph'
import { extractDocumentText } from '@/lib/services/document-intelligence'
import { classifyDocument } from '@/lib/services/openai'
import { newBatchEmail } from '@/lib/services/email-templates'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'

const DC_SITE_URL = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!

export async function POST(req: Request) {
  // ─── Auth check ────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-intake-secret')
  if (secret !== process.env.INTAKE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { vendorKey, files, return: returnInfo } = body
  if (!vendorKey || !files?.length) {
    return NextResponse.json({ error: 'vendorKey and files are required' }, { status: 400 })
  }

  const db = createServiceClient()

  // ─── Look up vendor / package ─────────────────────────────────────────────
  const { data: pkg } = await db
    .from('packages')
    .select('id, vendor_id, package_name, package_code, vendors(name, primary_contact_email)')
    .eq('package_code', vendorKey)
    .single()

  const packageName = (pkg as any)?.package_name ?? vendorKey
  const vendorName  = (pkg as any)?.vendors?.name ?? vendorKey

  // ─── Idempotency: check if this batch already exists ──────────────────────
  // Use first file's itemUniqueId as the dedup key
  const firstFileUniqueId = files[0]?.itemUniqueId
  if (firstFileUniqueId) {
    const { data: existing } = await db
      .from('document_versions')
      .select('batch_id')
      .eq('doc_unique_id', firstFileUniqueId)
      .single()
    if (existing?.batch_id) {
      return NextResponse.json({ success: true, batchId: existing.batch_id, duplicate: true }, { status: 200 })
    }
  }

  // ─── Create batch record ──────────────────────────────────────────────────
  const batchGuid = randomUUID()
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

  // ─── Process each file ────────────────────────────────────────────────────
  const auditErrors: string[] = []
  const processedDocs: Array<{
    fileName: string
    docVersionId: string
    aiSummary: string
    discipline: string
    docType: string
  }> = []

  // Target library path in DocumentControl (e.g. /K137  220kV  33kV Overhead Lines 2)
  const targetLibrary = returnInfo?.libraryPath ?? `/${vendorKey}`

  for (const file of files) {
    try {
      // 1. Copy file to DocumentControl
      let centralFileUrl: string | null = null
      let driveItemId: string | null = null
      try {
        const copied = await copyFileToDocControl(
          file.siteUrl,
          file.fileServerRelativeUrl,
          targetLibrary,
          file.fileName
        )
        centralFileUrl = copied.webUrl
        driveItemId    = copied.driveItemId
      } catch (copyErr: any) {
        auditErrors.push(`File copy failed for ${file.fileName}: ${copyErr.message}`)
        // Continue — still create a placeholder document_version
      }

      // 2. Extract text via Document Intelligence (use the central URL if available)
      let extractedText = ''
      let aiText = ''
      let discipline = ''
      let documentType = ''
      let topic = ''
      let docName = file.fileName.replace(/\.[^.]+$/, '')
      let summary = ''

      if (centralFileUrl) {
        try {
          // Generate a short-lived download URL via Graph
          const token = await getGraphToken()
          const dlUrl = `${DC_SITE_URL}/_layouts/15/download.aspx?SourceUrl=${encodeURIComponent(centralFileUrl)}`
          const diResult = await extractDocumentText(centralFileUrl)
          extractedText = diResult.extractedText

          // 3. AI classification
          const classification = await classifyDocument(
            extractedText,
            file.fileName,
            vendorName,
            packageName
          )
          docName      = classification.docName
          discipline   = classification.discipline
          documentType = classification.documentType
          topic        = classification.topic
          summary      = classification.summary
          aiText       = classification.rawAiText
        } catch (aiErr: any) {
          auditErrors.push(`AI processing failed for ${file.fileName}: ${aiErr.message}`)
        }
      }

      // 4. Parse document number / revision from filename
      const parsed = parseDocumentFileName(file.fileName)

      // 5. Create document_version record
      const { data: dv } = await db.from('document_versions').insert({
        batch_id:         batch.id,
        file_name:        file.fileName,
        revision:         parsed.revision,
        revision_sort:    parsed.revisionSort,
        source_site_url:  file.siteUrl,
        source_file_url:  file.fileServerRelativeUrl,
        central_file_url: centralFileUrl,
        doc_unique_id:    file.itemUniqueId,
        storage_provider: 'sharepoint',
        ai_text:          aiText || null,
        extracted_text:   extractedText || null,
        doc_name:         docName,
        discipline:       discipline || null,
        document_type:    documentType || null,
        topic:            topic || null,
        ai_metadata_source: aiText ? 'ai' : 'ai',
        status:           'uploaded',
        is_latest:        true,
      }).select().single()

      if (dv) {
        processedDocs.push({
          fileName:    file.fileName,
          docVersionId: dv.id,
          aiSummary:   summary,
          discipline,
          docType:     documentType,
        })
      }
    } catch (fileErr: any) {
      auditErrors.push(`Error processing ${file.fileName}: ${fileErr.message}`)
    }
  }

  // ─── Update batch status ──────────────────────────────────────────────────
  await db.from('batches').update({
    status:     processedDocs.length > 0 ? 'metadata_pending' : 'failed',
    updated_at: new Date().toISOString(),
  }).eq('id', batch.id)

  // ─── Send controller notification email ───────────────────────────────────
  const controllerEmails = (returnInfo?.controllerEmail ?? '')
    .split(/[;,]/).map((e: string) => e.trim()).filter(Boolean)

  if (controllerEmails.length > 0) {
    try {
      const firstDoc = processedDocs[0]
      const html = newBatchEmail({
        batchId:     batchGuid,
        batchDbId:   batch.id,
        packageName,
        vendorCode:  vendorKey,
        vendorEmail: (pkg as any)?.vendors?.primary_contact_email ?? '',
        fileNames:   files.map((f: any) => f.fileName),
        aiSummary:   firstDoc?.aiSummary ?? '',
        discipline:  firstDoc?.discipline ?? '',
        docType:     firstDoc?.docType ?? '',
      })
      await sendEmail({
        to:       controllerEmails,
        subject:  `[Doc Control] New batch received: ${packageName} (${files.length} file${files.length !== 1 ? 's' : ''})`,
        htmlBody: html,
      })
    } catch (emailErr: any) {
      auditErrors.push(`Controller email failed: ${emailErr.message}`)
    }
  }

  // ─── Audit event ─────────────────────────────────────────────────────────
  await db.from('audit_events').insert({
    entity_type: 'batch',
    entity_id:   batch.id,
    event_type:  'intake_received',
    actor_email: 'system_webhook',
    event_data:  {
      vendorKey,
      fileCount: files.length,
      batchGuid,
      processedCount: processedDocs.length,
      errors: auditErrors,
    },
  })

  return NextResponse.json({
    success:        true,
    batchId:        batch.id,
    batchGuid,
    filesProcessed: processedDocs.length,
    errors:         auditErrors.length > 0 ? auditErrors : undefined,
  }, { status: 201 })
}
