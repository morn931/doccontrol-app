import { RELEASED_DOCNOS } from './released'
import { isReady, type CarryoverRow } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// THE RELEASE GATE — what document control is asked to work on right now.
//
// Ruled by Morné on 2026-08-28: the carry-over had become confusing because the register
// showed all 528 documents while engineering had only decided some of them, so a
// controller could not tell which ones were safe to renumber. The gate reduces the working
// view to the documents engineering has actually released, so that EVERYTHING VISIBLE IS
// SAFE TO PROCEED WITH. More open up as each discipline is signed off.
//
// ⚠️ HIDDEN IS NOT DELETED, and this matters more than it looks. Document control worked
// ahead: a large number of rows already carry a new K124 number WITHOUT an engineering
// decision — mostly instrumentation, which is entirely unreviewed. Those rows keep
// everything they have; they simply leave the working view until engineering rules. Some
// will be told to keep their K038 number, in which case the allocation has to be undone —
// which is exactly why they must not sit in a list captioned "everything here is safe to
// proceed with". The live count is computed as hiddenButFinished and shown on the page
// rather than written here, where it would rot.
//
// The count of parked-but-finished rows is reported to the page so it can say so out loud.
// ─────────────────────────────────────────────────────────────────────────────

const NUM = /6105A\s*K\s*(?:038|124)[-\s]?(\d{4})[-\s]?([A-Z]{1,4}\d{0,3})[-\s]?(\d{3,4})/i

/**
 * The area-type-sequence part of a document number, which is what survives the K038 -> K124
 * change. Matching on the whole number would fail the moment a row is renumbered, and the
 * released list is written in K038 terms while a finished row carries a K124 number.
 */
export const numberKey = (v: unknown): string | null => {
  const m = NUM.exec(String(v ?? ''))
  return m ? `${m[1]}-${m[2].toUpperCase()}-${m[3]}` : null
}

const RELEASED_KEYS = new Set(RELEASED_DOCNOS.map(numberKey).filter(Boolean) as string[])

/** Every number the row is known by — file name, title block, and the new number. */
const keysOf = (r: CarryoverRow) =>
  [r.legacy_docno, r.ai_docno, r.docno].map(numberKey).filter(Boolean) as string[]

export const isReleased = (r: CarryoverRow) => keysOf(r).some((k) => RELEASED_KEYS.has(k))

export type GateResult = {
  /** what document control sees */
  rows: CarryoverRow[]
  /** how many are hidden, and why it is safe */
  hidden: number
  /** hidden rows that are already finished — the number that must be said out loud */
  hiddenButFinished: number
  releasedTotal: number
  releasedReady: number
  /** released by engineering but held back because they came from B, not A */
  releasedHeldBackB: number
}

/**
 * The "A" source — Jarrod's Excel, tagged `k038 highlighted` in the register.
 *
 * ⚠️ The tag is misleading and is kept only because it is what the data says: Jarrod's
 * selection was the VISIBLE rows of his workbook, not the highlighted ones — the yellow
 * fill stayed on rows he had hidden. Retag it and this constant must change with it.
 */
const SOURCE_A = 'k038 highlighted'

/**
 * Released AND from A. Ruled by Morné 2026-08-28: the carry-over is being worked A first,
 * so a document engineering has released but which came from the tender folders ("B")
 * stays hidden for now. Eleven documents sit in that position today — ten E113 bulk-fuel
 * ED01 drawings and one E101 ED05 — and they are HELD BACK, not rejected. They come in
 * with the rest of B.
 */
export const isVisible = (r: CarryoverRow) => r.source === SOURCE_A && isReleased(r)

export function applyGate(all: CarryoverRow[]): GateResult {
  const rows = all.filter(isVisible)
  const hiddenRows = all.filter((r) => !isVisible(r))
  return {
    rows,
    hidden: hiddenRows.length,
    hiddenButFinished: hiddenRows.filter(isReady).length,
    releasedTotal: rows.length,
    releasedReady: rows.filter(isReady).length,
    releasedHeldBackB: all.filter((r) => r.source !== SOURCE_A && isReleased(r)).length,
  }
}
