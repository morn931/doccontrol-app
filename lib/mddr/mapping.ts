/**
 * MDDR column mapping & normalisation.
 *
 * Each party maintains its register in Excel with slightly different column
 * layouts (CDDL, vendor SDDRs, and the master GMDR). This module:
 *   - detects the header row in a sheet,
 *   - maps every recognised header onto a canonical mddr_entries field,
 *   - preserves EVERY original column verbatim in a `raw` object so nothing is
 *     lost and any header can be filtered/reported on later,
 *   - normalises document numbers, dates and percentages for matching & merging.
 */

export type RegisterType = 'SDDR' | 'CDDL' | 'MDDR'

/** Canonical fields on mddr_entries that we map source columns onto. */
export interface MappedEntry {
  project_number?: string | null
  package_code?: string | null
  contract_number?: string | null
  package_description?: string | null
  sub_package?: string | null
  equipment_description?: string | null
  deliverable_name?: string | null
  service_provider_pkg_no?: string | null

  vendor_name?: string | null
  doc_owner?: string | null
  sub_supplier?: string | null

  document_number?: string | null
  normalized_document_number?: string | null
  ppe_doc_number?: string | null
  vendor_doc_id?: string | null
  document_title?: string | null
  document_description?: string | null
  sheet_number?: string | null

  discipline?: string | null
  document_type?: string | null
  area?: string | null
  tag_number?: string | null
  wbs_code?: string | null

  revision?: string | null
  document_status?: string | null

  planned_completion_date?: string | null
  actual_submission_date?: string | null
  actual_completion_date?: string | null

  activity_id?: string | null
  schedule_status?: string | null
  aconex_doc_status?: string | null
  aconex_review_status?: string | null

  issued_for?: string | null
  as_built_required?: string | null
  certified_final_required?: string | null

  progress_percent?: number | null
  comments?: string | null
}

// ─── Header → canonical field aliases ───────────────────────────
// Keys are normalised headers (lowercase, alphanumerics only).
const FIELD_ALIASES: Record<string, keyof MappedEntry> = {
  projectnumber:           'project_number',
  packagenumber:           'package_code',
  contractnumber:          'contract_number',

  // GMDR (master)
  packagedescription:      'package_description',
  subpackage:              'sub_package',
  equipmentdescription:    'equipment_description',
  ppecmepcdeliverables:    'deliverable_name',
  appointedserviceprovideroriginator: 'vendor_name',
  serviceproviderpackagenumber: 'service_provider_pkg_no',
  deliverablestatus:       'document_status',
  documenttitle:           'document_title',

  // Vendor / people
  docowner:                'doc_owner',
  subsupplier:             'sub_supplier',

  // Identity
  rdmcdocumentnumber:      'document_number',
  documentnumber:          'document_number',
  ppedocnumber:            'ppe_doc_number',
  abbdocumentid:           'vendor_doc_id',
  shtof:                   'sheet_number',   // "Sht. # of #"
  fulltitle:               'document_title',
  majordescription:        'document_description',

  // Classification
  discipline:              'discipline',
  documenttype:            'document_type',
  areafacility:            'area',
  areawbsno:               'wbs_code',       // "Area/ WBS No."
  tagnumberifany:          'tag_number',
  tagnumber:               'tag_number',

  // Revision & status
  revision:                'revision',
  ppedocstatus:            'document_status',
  aconexdocstatus:         'aconex_doc_status',
  aconexreviewstatus:      'aconex_review_status',

  // Dates
  duedate:                 'planned_completion_date',
  ifrtransmittaldate:      'actual_submission_date',
  revatransmittaldate:     'actual_submission_date',
  ifcifutransmittaldate:   'actual_completion_date',
  rev0transmittaldate:     'actual_completion_date',

  // Schedule / P6
  activityid:              'activity_id',
  schedulestatus:          'schedule_status',

  // Issue / requirement flags
  issuedfor:               'issued_for',
  asbuiltrequiredyn:       'as_built_required',
  certifiedfinalrequiredyn:'certified_final_required',

  // Progress / comments
  complete:                'progress_percent',   // "% Complete"
  comments:                'comments',
}

/** Headers that, when present, confirm a row is a real register header row. */
const HEADER_ANCHORS = new Set([
  'documentnumber', 'rdmcdocumentnumber', 'appointedserviceprovideroriginator',
])

export function normHeader(h: unknown): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Find the header row index (0-based) within the first ~15 rows of a sheet. */
export function findHeaderRow(rows: unknown[][]): number {
  const scan = Math.min(rows.length, 15)
  for (let i = 0; i < scan; i++) {
    const cells = rows[i] ?? []
    let hits = 0
    let anchor = false
    for (const c of cells) {
      const k = normHeader(c)
      if (!k) continue
      if (FIELD_ALIASES[k]) hits++
      if (HEADER_ANCHORS.has(k)) anchor = true
    }
    if (anchor && hits >= 4) return i
  }
  return -1
}

// ─── Value coercion ─────────────────────────────────────────────
function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s || s === '-' || s.toLowerCase() === 'n/a') return null
  return s
}

/** Coerce a cell into an ISO date (YYYY-MM-DD), handling JS Dates, Excel
 *  serials, dd.mm.yyyy, dd/mm/yyyy and ISO strings. */
export function toISODate(v: unknown): string | null {
  if (v == null || v === '') return null
  // Use LOCAL calendar components, not toISOString(): SheetJS (cellDates) builds the
  // Date at local midnight, so toISOString() in a +UTC zone (SA = UTC+2) shifts it back
  // a day (e.g. 13 Feb → 12 Feb). Reading the local Y/M/D keeps the intended date.
  if (v instanceof Date && !isNaN(v.getTime())) return validISO(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'number' && isFinite(v)) {
    // Excel serial (days since 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)               // ISO / ISO datetime
  if (m) return validISO(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/)  // dd.mm.yyyy
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = '20' + y
    return validISO(+y, +mo, +d)
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Return YYYY-MM-DD only if it is a real calendar date, else null (guards
 *  against impossible values like 2026-06-31 that Postgres rejects). */
function validISO(y: number, mo: number, d: number): string | null {
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "33%" / "0.33" / 33 → 33 (0-100). */
export function toPercent(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v <= 1 ? Math.round(v * 100) : Math.round(v)
  const s = String(v).replace('%', '').trim()
  if (!s) return null
  const n = Number(s)
  if (!isFinite(n)) return null
  return n <= 1 && n > 0 ? Math.round(n * 100) : Math.round(n)
}

/** Normalise a document number for matching/merging across registers and against
 *  the live document-control system. Strips revisions, sheet/ext suffixes,
 *  whitespace and upper-cases. Returns null for blanks/placeholders. */
export function normalizeDocNumber(raw: unknown): string | null {
  const s0 = str(raw)
  if (!s0) return null
  let s = s0.toUpperCase()
  s = s.replace(/\.[A-Z0-9]{2,4}$/, '')                  // file extension
  s = s.replace(/[_\s]*REV[._\s-]*[A-Z0-9]{1,3}$/i, '')  // "_REV A"
  s = s.replace(/_[A-Z0-9]{1,3}$/, '')                   // trailing "_A"
  s = s.replace(/\s+/g, '')
  // Reconcile discipline/type delimiter difference between registers so the same
  // document merges into one master row: the master GMDR splits the discipline
  // letter from the type code ("…-E-GAD-…") while vendor SDDRs and the live
  // document filenames fuse them ("…-EGAD-…"). Collapse to the fused form.
  s = s.replace(/-([A-Z])-([A-Z]{2,4})-/g, '-$1$2-')
  return s || null
}

// Project doc numbers: 6105A + package (letter + 3 digits + optional trailing
// letter, e.g. K137 or E511B) + "-". The trailing letter matters for E511B/E516B.
const DOCNUM_RE = /^6105A[A-Z]\d{3}[A-Z]?-/i

/** Map a single data row → { entry, raw }. `headers` and `values` are aligned. */
export function mapRow(
  headers: string[],
  values: unknown[],
): { entry: MappedEntry; raw: Record<string, unknown> } {
  const entry: MappedEntry = {}
  const raw: Record<string, unknown> = {}

  headers.forEach((h, i) => {
    const v = values[i]
    if (h == null || h === '') return
    const label = String(h).trim()
    if (v != null && v !== '') raw[label] = v instanceof Date ? toISODate(v) : v

    const field = FIELD_ALIASES[normHeader(h)]
    if (!field) return

    switch (field) {
      case 'planned_completion_date':
      case 'actual_submission_date':
      case 'actual_completion_date':
        entry[field] = toISODate(v); break
      case 'progress_percent':
        entry.progress_percent = toPercent(v); break
      default:
        // Prefer the first non-empty mapping (e.g. don't let a blank
        // "Document Number" overwrite a populated "RDMC Document Number").
        if ((entry as any)[field] == null) (entry as any)[field] = str(v)
    }
  })

  // Derive document_number from the RDMC number; fall back to raw value.
  if (entry.document_number) {
    entry.normalized_document_number = normalizeDocNumber(entry.document_number)
  }

  // Derive package / project from the document number when not explicit.
  const dn = entry.document_number
  if (dn && DOCNUM_RE.test(dn)) {
    if (!entry.project_number) entry.project_number = dn.slice(0, 5)        // 6105A
    if (!entry.package_code)   entry.package_code   = dn.slice(5).split('-')[0] // K137
  }
  if (!entry.package_code && entry.service_provider_pkg_no) {
    const m = entry.service_provider_pkg_no.match(/\b([KEX]\d{3}[A-Z]?)\b/i)
    if (m) entry.package_code = m[1].toUpperCase()
  }
  if (entry.package_code) entry.package_code = entry.package_code.toUpperCase()

  return { entry, raw }
}

/** Does this mapped row represent a real, awarded document (has a doc number)? */
export function isAwardedRow(entry: MappedEntry): boolean {
  return !!entry.normalized_document_number && DOCNUM_RE.test(entry.document_number ?? '')
}
