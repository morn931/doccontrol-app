import { RELEASED_DOCNOS } from './released'
import { isReady, type CarryoverRow } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// THE WORKING SCOPE — what document control is asked to work on right now.
//
// The carry-over holds 528 documents from two sources and engineering has decided only
// some of them, so showing everything at once is what made the register confusing. This
// file is the single place that decides what is in front of people, so flipping the team
// from one batch to the next is one line rather than a hunt.
//
//   A  = Jarrod's Excel      (source 'k038 highlighted', 199 rows, one package)
//   B  = the OneDrive folders (source 'tender folder',   329 rows, eight vendor packages)
//
// ⚠️ THE TWO MODES DO NOT MEAN THE SAME THING, and the page must not say they do.
//   'A-released' — A, reduced to what engineering signed off. Everything visible is safe
//                  to proceed with, and the page says exactly that.
//   'B'          — the whole of B. Engineering has NOT triaged B: it has ruled on eleven
//                  of the 329 and nothing else. So the page must NOT tell anyone that
//                  everything visible is safe — that claim is only true in 'A-released',
//                  and repeating it here would be the same confusion with a new batch.
//
// ⚠️ HIDDEN IS NOT DELETED. Document control has worked ahead of the engineering decision
// on both sources, so switching scope always parks finished rows. They keep everything
// they have. The live count is computed as hiddenButFinished and shown on the page rather
// than written into a comment, where it would rot.
// ─────────────────────────────────────────────────────────────────────────────

/** Flip this to move the team from one batch to the next. */
export const SCOPE: Scope = 'B'

export type Scope = 'A-released' | 'B' | 'all'

/**
 * The "A" source tag. ⚠️ Misleading, and kept only because it is what the data says:
 * Jarrod's selection was the VISIBLE rows of his workbook, not the highlighted ones — the
 * yellow fill stayed on rows he had hidden. Retag it and this constant must change too.
 */
const SOURCE_A = 'k038 highlighted'
const SOURCE_B = 'tender folder'

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

export const isVisible = (r: CarryoverRow, scope: Scope = SCOPE) => {
  if (scope === 'all') return true
  if (scope === 'B') return r.source === SOURCE_B
  return r.source === SOURCE_A && isReleased(r)
}

export type GateResult = {
  scope: Scope
  /** what document control sees */
  rows: CarryoverRow[]
  /** true only when every visible row carries an engineering decision */
  allReleased: boolean
  hidden: number
  /** hidden rows that are already finished — the number that must be said out loud */
  hiddenButFinished: number
  visibleTotal: number
  visibleReady: number
  /** of what is visible, how many engineering has actually signed off */
  visibleReleased: number
  /** released by engineering but not in the current scope */
  releasedOutOfScope: number
}

export function applyGate(all: CarryoverRow[], scope: Scope = SCOPE): GateResult {
  const rows = all.filter((r) => isVisible(r, scope))
  const hiddenRows = all.filter((r) => !isVisible(r, scope))
  const visibleReleased = rows.filter(isReleased).length
  return {
    scope,
    rows,
    allReleased: scope === 'A-released',
    hidden: hiddenRows.length,
    hiddenButFinished: hiddenRows.filter(isReady).length,
    visibleTotal: rows.length,
    visibleReady: rows.filter(isReady).length,
    visibleReleased,
    releasedOutOfScope: hiddenRows.filter(isReleased).length,
  }
}
