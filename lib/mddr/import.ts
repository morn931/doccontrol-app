/**
 * Shared MDDR import orchestration — used by both the /api/mddr/upload route and
 * the scripts/import-direct.ts bulk loader, so parsing/merge logic lives in one place.
 *
 * Parses a register workbook (multi-sheet, header-row aware), buckets rows into
 * awarded documents (merged into one master row per normalized document number)
 * and unawarded scope placeholders, then writes to mddr_entries.
 */
import * as XLSX from 'xlsx'
import {
  findHeaderRow, mapRow, isAwardedRow, type RegisterType, type MappedEntry,
} from './mapping'

// Canonical fields carried from a MappedEntry onto an mddr_entries row.
export const ENTRY_FIELDS: (keyof MappedEntry)[] = [
  'project_number', 'package_code', 'contract_number', 'package_description',
  'sub_package', 'equipment_description', 'deliverable_name', 'service_provider_pkg_no',
  'vendor_name', 'doc_owner', 'sub_supplier',
  'document_number', 'normalized_document_number', 'ppe_doc_number', 'vendor_doc_id',
  'document_title', 'document_description', 'sheet_number',
  'discipline', 'document_type', 'area', 'tag_number', 'wbs_code',
  'revision', 'document_status',
  'planned_completion_date', 'actual_submission_date', 'actual_completion_date',
  'activity_id', 'schedule_status', 'aconex_doc_status', 'aconex_review_status',
  'issued_for', 'as_built_required', 'certified_final_required',
  'progress_percent', 'comments',
]

// Richer registers win when two sources disagree on which "owns" the master row.
const SOURCE_RANK: Record<string, number> = { MDDR: 0, SDDR: 1, CDDL: 2 }

// Fields a re-upload should REFRESH (incoming wins) in 'refresh' mode. Deliberately
// limited to DATES + PROGRESS (the agreed scope) — NOT revision/status, which the live
// document-control system advances and a static vendor register would regress
// (e.g. live rev "C" downgraded to the file's "0"). Everything else keeps the
// fill-blanks / first-wins merge so cross-register enrichment isn't clobbered.
const REFRESH_FIELDS = new Set<keyof MappedEntry>([
  'planned_completion_date', 'actual_submission_date', 'actual_completion_date',
  'progress_percent',
])

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/** Keep a's value unless it is empty, then take b's (a wins when both set). */
function mergeField(a: any, b: any) { return a == null || a === '' ? b : a }

export interface ImportOptions {
  registerType: RegisterType
  formPackage?: string | null
  formVendor?: string | null
  uploadMode?: 'merge' | 'override' | 'refresh'
  dryRun?: boolean
  fileName: string
}

export type PreviewChange = { doc: string; changes: { field: string; from: unknown; to: unknown }[] }

export interface ImportResult {
  registerId: string
  inserted: number
  updated: number
  skipped: number
  awarded: number
  placeholders: number
  errors: string[]
  preview?: PreviewChange[]
}

export async function importWorkbook(
  db: any, fileBuffer: Buffer | ArrayBuffer, opts: ImportOptions,
): Promise<ImportResult> {
  const registerType = opts.registerType
  const formPackage  = (opts.formPackage ?? '').trim().toUpperCase() || null
  const formVendor   = (opts.formVendor ?? '').trim() || null
  const uploadMode   = opts.uploadMode ?? 'merge'
  const dryRun       = !!opts.dryRun

  const errors: string[] = []
  let skipped = 0

  const wb = XLSX.read(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer),
    { type: 'buffer', cellDates: true })

  // ── Vendor lookup (name/code → id) ──────────────────────────
  const { data: vendorRows } = await db.from('vendors').select('id, name, code')
  const vendorByKey = new Map<string, string>()
  for (const v of vendorRows ?? []) {
    if (v.code) vendorByKey.set(v.code.toUpperCase(), v.id)
    if (v.name) vendorByKey.set(v.name.toUpperCase(), v.id)
  }
  const resolveVendorId = (name: string | null) =>
    name ? (vendorByKey.get(name.toUpperCase()) ?? null) : null

  // ── Register record (skip the write in dry-run) ─────────────
  let registerId = 'dry-run'
  if (!dryRun) {
    const { data: regRow, error: regErr } = await db.from('mddr_registers').insert({
      register_type: registerType,
      file_name:     opts.fileName,
      package_code:  formPackage,
      vendor_name:   formVendor,
      vendor_id:     resolveVendorId(formVendor),
      // mddr_registers.upload_mode CHECK allows merge|override only; 'refresh' is a merge variant.
      upload_mode:   uploadMode === 'refresh' ? 'merge' : uploadMode,
    }).select('id').single()
    if (regErr) throw new Error(`Register record: ${regErr.message}`)
    registerId = regRow.id
  }

  // ── Walk every sheet; bucket rows ───────────────────────────
  const awarded = new Map<string, any>()
  const placeholders: any[] = []

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    // Skip non-deliverable tabs (e.g. a CDDL's "Docs not in Use" sheet) so retired
    // documents aren't loaded as live awarded rows.
    if (/not\s*in\s*use|do\s*not\s*use/i.test(sheetName)) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1, raw: true, defval: null, blankrows: false,
    })
    const hr = findHeaderRow(rows)
    if (hr < 0) continue
    const headers = (rows[hr] as unknown[]).map(h => (h == null ? '' : String(h)))

    for (let r = hr + 1; r < rows.length; r++) {
      const values = rows[r] as unknown[]
      if (!values || values.every(v => v == null || v === '')) continue

      const { entry, raw } = mapRow(headers, values)
      const vendorName = entry.vendor_name ?? formVendor ?? null
      const pkg        = entry.package_code ?? formPackage ?? null
      const rawKey     = `${registerType}:${pkg ?? sheetName}`

      const base: any = { source_register_id: registerId, source_type: registerType }
      for (const f of ENTRY_FIELDS) if (entry[f] != null) base[f] = entry[f]
      base.package_code = pkg
      base.vendor_name  = vendorName
      base.vendor_id    = resolveVendorId(vendorName)
      base.source_types = [registerType]
      base.raw          = { [rawKey]: raw }
      if (entry.progress_percent != null) base.progress_source = 'register'

      if (isAwardedRow(entry)) {
        base.is_awarded = true
        const key = entry.normalized_document_number!
        const prev = awarded.get(key)
        if (!prev) awarded.set(key, base)
        else {
          for (const f of ENTRY_FIELDS) prev[f] = mergeField(prev[f], base[f])
          prev.raw = { ...prev.raw, ...base.raw }
        }
      } else {
        if (!entry.deliverable_name && !entry.equipment_description &&
            !entry.document_title && !vendorName) { skipped++; continue }
        base.is_awarded = false
        base.normalized_document_number = null
        placeholders.push(base)
      }
    }
  }

  // ── Override: drop this register-type's prior contribution ──
  if (!dryRun && uploadMode === 'override') {
    let del = db.from('mddr_entries').delete().contains('source_types', [registerType])
    if (formPackage) del = del.eq('package_code', formPackage)
    const { error } = await del
    if (error) errors.push(`Override delete: ${error.message}`)
  }

  // Placeholders have no merge key → always replace this type+package's prior set.
  if (!dryRun) {
    let del = db.from('mddr_entries').delete()
      .eq('is_awarded', false).eq('source_type', registerType)
    if (formPackage) del = del.eq('package_code', formPackage)
    const { error } = await del
    if (error) errors.push(`Placeholder cleanup: ${error.message}`)
  }

  // ── Merge awarded rows against existing master rows ─────────
  let inserted = 0, updated = 0
  const preview: PreviewChange[] = []
  const existing = new Map<string, any>()
  for (const part of chunk([...awarded.keys()], 200)) {
    const { data } = await db.from('mddr_entries').select('*').in('normalized_document_number', part)
    for (const row of data ?? []) existing.set(row.normalized_document_number, row)
  }

  const toInsert: any[] = []
  const toUpdate: { id: string; patch: Record<string, unknown> }[] = []
  for (const [key, incoming] of awarded) {
    const prev = existing.get(key)
    if (!prev) { toInsert.push(incoming); continue }
    const rowChanges: PreviewChange['changes'] = []
    const patch: Record<string, unknown> = {}
    for (const f of ENTRY_FIELDS) {
      // 'refresh': the volatile register-owned fields take the incoming value (a newer
      // register revises dates/progress); every other field keeps fill-blanks merge.
      const raw = (uploadMode === 'refresh' && REFRESH_FIELDS.has(f) && incoming[f] != null)
        ? incoming[f] : mergeField(prev[f], incoming[f])
      // Compare nullish-normalised: an absent incoming field (undefined) must NOT count
      // as a change against a stored null — that produced phantom "updates" on every
      // re-upload (writing undefined / rewriting raw for thousands of unchanged rows).
      const newVal = raw ?? null
      const prevVal = prev[f] ?? null
      if (newVal !== prevVal) {
        patch[f] = newVal
        if (process.env.MDDR_DIAG === '1' || (REFRESH_FIELDS.has(f) && newVal != null))
          rowChanges.push({ field: f as string, from: prevVal, to: newVal })
      }
    }
    // Provenance — only when it actually changes, to keep the patch small.
    const newTypes = [...new Set([...(prev.source_types ?? []), registerType])]
    if (newTypes.length !== (prev.source_types ?? []).length) patch.source_types = newTypes
    const newType = newTypes.slice().sort((a, b) => (SOURCE_RANK[b] ?? -1) - (SOURCE_RANK[a] ?? -1))[0]
    if (newType !== prev.source_type) patch.source_type = newType
    if (incoming.vendor_id && incoming.vendor_id !== prev.vendor_id) patch.vendor_id = incoming.vendor_id
    if (incoming.progress_source && incoming.progress_source !== prev.progress_source) patch.progress_source = incoming.progress_source
    if (rowChanges.length) preview.push({ doc: key, changes: rowChanges })
    if (Object.keys(patch).length) {
      patch.raw = { ...(prev.raw ?? {}), ...(incoming.raw ?? {}) }
      patch.source_register_id = incoming.source_register_id
      toUpdate.push({ id: prev.id, patch })
    }
  }

  // ── Dry-run: report what WOULD change, write nothing ────────
  if (dryRun) {
    return {
      registerId, inserted: toInsert.length, updated: toUpdate.length, skipped,
      awarded: awarded.size, placeholders: placeholders.length, errors, preview,
    }
  }

  for (const part of chunk(toInsert, 500)) {
    const { error } = await db.from('mddr_entries').insert(part)
    if (error) errors.push(`Insert: ${error.message}`); else inserted += part.length
  }
  // Narrow per-row updates (only the changed columns) in small concurrent batches — far
  // lighter than a full-row upsert on this 96k-row, multi-index table (which timed out).
  for (const part of chunk(toUpdate, 25)) {
    const res = await Promise.all(part.map((u) =>
      db.from('mddr_entries').update(u.patch).eq('id', u.id).then((r: any) => r.error)))
    for (const e of res) { if (e) { if (errors.length < 10) errors.push(`Update: ${e.message}`) } else updated += 1 }
  }
  for (const part of chunk(placeholders, 500)) {
    const { error } = await db.from('mddr_entries').insert(part)
    if (error) errors.push(`Placeholder insert: ${error.message}`); else inserted += part.length
  }

  await db.from('mddr_registers').update({
    row_count: inserted + updated,
    notes: errors.length ? errors.slice(0, 5).join(' | ') : null,
  }).eq('id', registerId)

  return { registerId, inserted, updated, skipped, awarded: awarded.size, placeholders: placeholders.length, errors }
}
