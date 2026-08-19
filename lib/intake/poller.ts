/**
 * In-app vendor intake poller — the replacement for the Power Automate per-vendor "small flows"
 * + la-intake-core. Runs on a cron (per minute). For each vendor with `new_intake_enabled`:
 *   1. list new PDFs in its drop-off ("FROM VENDOR") library, skipping anything already ingested;
 *   2. group them by arrival (files within a 1-minute window = one batch — same principle as the
 *      old small flows, but grouped from the first drop rather than a fixed poll clock);
 *   3. per batch: copy each file into the DocumentControl package bucket, run the pre-review AI
 *      (lib/intake/ai-review — extract + SDDR check), create the batch + document_versions, record
 *      the files in the ingest ledger, and email the controller a summary with the ✅/❌ checks.
 *
 * Behind the per-vendor flag, so nothing changes for any vendor still on Power Automate.
 * Advisory: the AI flags issues; the controller still decides (reject vs send to reviewers).
 */
import { randomUUID } from 'crypto'
import {
  listDropoffPdfs, copyDriveItemToLibrary, getDriveItemContentBytes, sendEmail,
} from '@/lib/services/graph'
import { reviewVendorDocument, type SddrExpected, type AiReview } from './ai-review'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'

const GROUP_WINDOW_MS = 60_000 // files dropped within 60s of each other form one batch

export interface PollSummary {
  vendorsPolled: number
  newFiles: number
  batchesCreated: number
  errors: string[]
}

/** Base document number for the SDDR lookup: strip the extension and a trailing _<revision>. */
function baseDocNumber(fileName: string, revision: string | null): string {
  const noExt = fileName.replace(/\.[^.]+$/, '')
  return revision ? noExt.replace(new RegExp(`_${revision}$`, 'i'), '') : noExt
}

/** Group files (sorted oldest-first) into arrival clusters: a new cluster starts when the gap to
 *  the previous file's creation time exceeds the window. */
function groupByArrival<T extends { createdDateTime: string }>(files: T[]): T[][] {
  const groups: T[][] = []
  let cur: T[] = []
  let prev = 0
  for (const f of files) {
    const t = Date.parse(f.createdDateTime || '') || 0
    if (cur.length && t - prev > GROUP_WINDOW_MS) { groups.push(cur); cur = [] }
    cur.push(f); prev = t
  }
  if (cur.length) groups.push(cur)
  return groups
}

async function lookupSddr(db: any, docNumber: string): Promise<SddrExpected | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const { data, error } = await db.from('mddr_entries')
        .select('document_number, document_title, revision, document_type, document_status, issued_for')
        .eq('document_number', docNumber).limit(1)
      if (error) throw new Error(error.message)
      return (data && data[0]) ? (data[0] as SddrExpected) : null
    } catch {
      await new Promise((r) => setTimeout(r, 1200)) // mddr_entries times out intermittently
    }
  }
  return null
}

function reviewLine(fileName: string, r: AiReview | null): string {
  if (!r) return `<li><b>${fileName}</b> — AI review unavailable</li>`
  const icon = r.overall === 'MISMATCH' ? '❌' : r.overall === 'PASS' ? '✅' : 'ℹ️'
  const mism = r.validation.filter((v) => !v.match)
  const detail = mism.length
    ? '<ul>' + mism.map((v) => `<li>${v.field}: SDDR "${v.expected}" vs document "${v.found}"</li>`).join('') + '</ul>'
    : (r.overall === 'EXTRACTED' ? '<div style="color:#555">No SDDR on record — extracted only.</div>' : '<div style="color:#555">All checked fields match the SDDR.</div>')
  return `<li><b>${fileName}</b> — AI Check: ${icon} ${r.overall}${detail}</li>`
}

async function ingestBatch(db: any, site: any, files: any[], summary: PollSummary) {
  const pkg = site.packages
  const packageCode: string = pkg?.package_code ?? ''
  const controllerEmail: string | null = site.controller_email ?? null

  const batchGuid = randomUUID()
  const { data: batch, error: batchErr } = await db.from('batches').insert({
    batch_guid: batchGuid,
    vendor_id: pkg?.vendor_id ?? null,
    package_id: site.package_id ?? null,
    source_site_url: site.site_url ?? null,
    target_library: site.documentcontrol_library ?? null,
    controller_email: controllerEmail,
    status: 'intake_received',
    file_count: files.length,
    received_at: new Date().toISOString(),
    source: 'vendor', // a vendor intake — the "ingested by the poller" origin is in the audit event
  }).select().single()
  if (batchErr || !batch) throw new Error(`create batch: ${batchErr?.message}`)

  const results: { fileName: string; review: AiReview | null }[] = []

  for (const f of files) {
    const parsed = parseDocumentFileName(f.name)
    const revision = parsed.revision ?? null

    // 1. copy into the DocumentControl bucket (best-effort — needs documentcontrol_library set)
    let centralUrl: string | null = null
    if (site.documentcontrol_library) {
      try {
        centralUrl = await copyDriveItemToLibrary(
          f.driveId, f.id, 'https://ppetechcoza.sharepoint.com/sites/DocumentControl',
          site.documentcontrol_library, f.name,
        )
      } catch (e: any) { summary.errors.push(`copy ${f.name}: ${e?.message}`) }
    }

    // 2. run the pre-review AI (SDDR-aware; extraction-only when no SDDR row)
    let review: AiReview | null = null
    try {
      const bytes = Buffer.from(await getDriveItemContentBytes(f.driveId, f.id))
      const sddr = await lookupSddr(db, baseDocNumber(f.name, revision))
      const out = await reviewVendorDocument({ pdfBytes: bytes, fileName: f.name, sddr })
      if (out.ok) review = out.review
      else summary.errors.push(`ai ${f.name}: ${out.error}`)
    } catch (e: any) { summary.errors.push(`ai ${f.name}: ${e?.message}`) }

    // 3. document_version row (carrying the AI classification + the check report)
    const { error: dvErr } = await db.from('document_versions').insert({
      batch_id: batch.id,
      file_name: f.name,
      revision,
      revision_sort: (parsed as any).revisionSort ?? revision,
      source_site_url: site.site_url ?? null,
      central_file_url: centralUrl,
      doc_unique_id: f.id,
      storage_provider: 'sharepoint',
      doc_name: review?.extracted.title ?? null,
      discipline: review?.extracted.discipline ?? null,
      document_type: review?.extracted.document_type ?? null,
      topic: review?.extracted.topic ?? null,
      ai_text: review?.checks.notes ?? null,
      ai_metadata_source: 'ai', // CHECK: 'ai' | 'manually_confirmed' | 'manually_overridden'
      ai_review: review ?? null,
      status: 'uploaded',
      is_latest: true,
    })
    if (dvErr) summary.errors.push(`dv ${f.name}: ${dvErr.message}`)

    // 4. ledger — never ingest this drop-off file again
    await db.from('intake_ingest_ledger').upsert(
      { package_code: packageCode, drive_item_id: f.id, file_name: f.name, batch_id: batch.id },
      { onConflict: 'drive_item_id', ignoreDuplicates: true },
    )
    results.push({ fileName: f.name, review })
  }

  await db.from('batches').update({ status: 'metadata_pending', updated_at: new Date().toISOString() }).eq('id', batch.id)
  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batch.id, event_type: 'intake_received_from_poller',
    actor_email: 'system_intake_poller',
    event_data: { packageCode, fileCount: files.length, batchGuid, files: files.map((x) => x.name) },
  })

  // 5. notify the controller with the AI check summary
  if (controllerEmail) {
    const anyMismatch = results.some((r) => r.review?.overall === 'MISMATCH')
    try {
      await sendEmail({
        to: controllerEmail.split(/[;,]/).map((s) => s.trim()).filter(Boolean),
        subject: `New vendor upload — ${packageCode} — ${files.length} document(s)${anyMismatch ? ' — ⚠ AI flagged a mismatch' : ''}`,
        htmlBody: [
          `<p>${files.length} new document(s) landed in <b>${packageCode}</b> and have been auto-reviewed:</p>`,
          '<ul>', ...results.map((r) => reviewLine(r.fileName, r.review)), '</ul>',
          '<p style="color:#777;font-size:12px">The AI check is advisory — open the batch to review and either reject or send for review.</p>',
        ].join(''),
      })
    } catch (e: any) { summary.errors.push(`notify ${packageCode}: ${e?.message}`) }
  }

  summary.batchesCreated++
}

async function pollOneVendor(db: any, site: any, summary: PollSummary) {
  const packageCode: string = site.packages?.package_code ?? ''
  if (!site.site_url || !site.dropoff_library) return
  const files = await listDropoffPdfs(site.site_url, site.dropoff_library)
  if (!files.length) return

  const { data: seen } = await db.from('intake_ingest_ledger')
    .select('drive_item_id').eq('package_code', packageCode).limit(50000)
  const seenIds = new Set((seen ?? []).map((r: any) => r.drive_item_id))
  const fresh = files.filter((f) => !seenIds.has(f.id))
  if (!fresh.length) return
  summary.newFiles += fresh.length

  for (const group of groupByArrival(fresh)) {
    try { await ingestBatch(db, site, group, summary) }
    catch (e: any) { summary.errors.push(`${packageCode} batch: ${e?.message}`) }
  }
}

/** Poll every enabled vendor's drop-off library and ingest new documents. */
export async function runIntakePoll(db: any): Promise<PollSummary> {
  const summary: PollSummary = { vendorsPolled: 0, newFiles: 0, batchesCreated: 0, errors: [] }
  const { data: sites } = await db.from('vendor_sites')
    .select('package_id, site_url, dropoff_library, documentcontrol_library, controller_email, packages(package_code, package_name, vendor_id)')
    .eq('new_intake_enabled', true).eq('active', true)
  for (const site of sites ?? []) {
    summary.vendorsPolled++
    try { await pollOneVendor(db, site, summary) }
    catch (e: any) { summary.errors.push(`${site.packages?.package_code ?? '?'}: ${e?.message}`) }
  }
  return summary
}
