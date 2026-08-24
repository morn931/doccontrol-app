// ─────────────────────────────────────────────────────────────────────────────
// K038 CARRY-OVER REGISTER — the documents that went out for tender without ever
// reaching the CDDL, being brought back into K124.
//
// TYPES AND PURE HELPERS ONLY — no server imports.
//
// The register is a client component and imports isReady/k124Candidates from here. If
// these lived alongside the data loader, that import would drag next/headers into the
// client bundle and the build fails outright.
//
// Lives in CoreDocs because that is where document control already work, where the CDDL
// they paste into lives, and where this table sits — a second app meant a second login
// for the only people who need it.
//
// Reads public.cddl_carryover. Three kinds of field, and keeping them apart
// is the whole design:
//   · provenance  — where the file is (scanner-owned)
//   · ai_*        — what Claude read IN the document (ADVISORY; a controller may disagree)
//   · decision    — what document control allocates. These map 1:1 onto the real CDDL's
//                   30 export columns so a finished row pastes straight into K124.
//
// The AI's reading is never written into a decision field. Once merged there is no way to
// tell an extracted document number from an approved one, and an extracted number is
// exactly what nobody should accept unseen.
// ─────────────────────────────────────────────────────────────────────────────

export type CarryoverRow = {
  id: string
  temp_ref: string
  // provenance
  source_path: string
  source_files: string[]
  target_package: string | null
  transfer_subfolder: string | null
  doc_class: string | null
  legacy_docno: string | null
  legacy_package: string | null
  legacy_area: string | null
  file_bytes: number | null
  // what the reader found in the document
  ai_docno: string | null
  ai_title: string | null
  ai_revision: string | null
  ai_status: string | null
  ai_discipline: string | null
  ai_doc_type: string | null
  ai_topic: string | null
  ai_summary: string | null
  ai_kind: string | null
  ai_has_border: boolean | null
  ai_confidence: string | null
  ai_read_at: string | null
  ai_error: string | null
  // what document control decides — the CDDL columns
  wbs: string | null
  discipline: string | null
  doc_type: string | null
  seq_no: string | null
  revision: string | null
  docno: string | null
  ppe_docno: string | null
  sheet: string | null
  area_facility: string | null
  major_desc: string | null
  broad_type: string | null
  title: string | null
  rev_a_transmittal: string | null
  rev0_transmittal: string | null
  aconex_doc_status: string | null
  aconex_review_status: string | null
  doc_owner: string | null
  comments: string | null
  due: string | null
  main_group: string | null
  sub_group: string | null
  bh: string | null
  drawing_pack: string | null
  activity_id: string | null
  schedule_status: string | null
  // workflow
  status: string
  decided_by: string | null
  decided_at: string | null
}

/** The fields document control fills in — the ones the editor may write. Anything not on
 *  this list is provenance or an AI reading and is NOT writable from the register. */
export const DECISION_FIELDS = [
  'docno', 'wbs', 'discipline', 'doc_type', 'seq_no', 'revision', 'ppe_docno', 'sheet',
  'area_facility', 'major_desc', 'broad_type', 'title', 'rev_a_transmittal',
  'rev0_transmittal', 'aconex_doc_status', 'aconex_review_status', 'doc_owner',
  'comments', 'due', 'main_group', 'sub_group', 'bh', 'drawing_pack', 'activity_id',
  'schedule_status',
] as const
export type DecisionField = (typeof DECISION_FIELDS)[number]

export type CarryoverView = {
  rows: CarryoverRow[]
  total: number
  read: number
  unread: number
  failed: number
  withBorder: number
  withoutBorder: number
  withPrintedNumber: number
  done: number
  packages: { name: string; docs: number; done: number }[]
  /** how many decision rows are complete enough to paste into the CDDL */
  readyToPaste: number
}

/**
 * Whether a carry-over document ALREADY carries a K124 number, and whether that number is
 * in the Phase 1 CDDL. Checked against BOTH the file name and the number printed on the
 * document, because the two disagree on 16 of these — a document filed under a K038 name
 * can turn out to be a registered K124 drawing, and it would be wrong to treat it as new.
 */
export type K124Status = {
  number: string
  where: 'filename' | 'on the document'
  /** in the CDDL register itself */
  inCddl: boolean
  /** known to the MDDR master register even though the CDDL does not carry it — the
   *  common case here, and a very different problem from a document nobody has recorded */
  inMddr: boolean
}

export const k124Candidates = (r: CarryoverRow): { number: string; where: 'filename' | 'on the document' }[] => {
  const out: { number: string; where: 'filename' | 'on the document' }[] = []
  const seen = new Set<string>()
  for (const [num, where] of [[r.legacy_docno, 'filename'], [r.ai_docno, 'on the document']] as const) {
    if (!num || !/6105AK124/i.test(num)) continue
    const k = num.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ number: num.trim(), where })
  }
  return out
}

/** A row is ready to hand over once it has the two things it came here missing. */
export const isReady = (r: CarryoverRow) => !!(r.docno && r.wbs)

