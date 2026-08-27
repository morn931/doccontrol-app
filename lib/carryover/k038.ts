import type { CarryoverRow } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// THE ORIGINAL K038 NUMBER, for the drawing office.
//
// A document coming across from K038 gets a NEW K124 number here. The drawing office
// still knows it by its old one, so the export has to carry the old number beside the new
// one or the two registers cannot be reconciled by anyone downstream.
//
// Two places the old number can be found, and they do not always agree:
//   · `legacy_docno` — parsed from the FILE NAME as it sat in the transfer folder;
//   · `ai_docno`     — what the reader found printed in the TITLE BLOCK.
//
// The filename wins. It is the number the document was filed and issued under, which is
// what the drawing office will have in its own records; the title block is sometimes an
// internal Q-number, sometimes a sheet reference, and on a handful of drawings simply the
// wrong number (21 rows disagree today). The title block is used only when the filename
// carries no K038 number at all.
//
// A STRICT PATTERN, deliberately. Only a well-formed 6105AK038-AAAA-XNN-NNNN is returned:
// putting a half-recognised string in a column headed "Original K038 Number" is worse than
// leaving it blank, because a blank prompts someone to look while a wrong number does not.
// Both raw values stay visible on the Traceability sheet for anything this rejects.
// ─────────────────────────────────────────────────────────────────────────────

// The third group takes BOTH shapes the register uses: the old numeric type code (ED19,
// FA06, MD05) and the current lettered one (EDST, EGAD, ECAL). An earlier version allowed
// only the first and silently dropped 6105AK038-6243-EDST-0002.
// The sequence must be digits, so 000X and ???? are rejected rather than exported as if
// they were real numbers.
const K038_NUMBER = /6105A\s*K\s*038[-\s]?(\d{4})[-\s]?([A-Z]{1,4}\d{0,3})[-\s]?(\d{3,4})\b/i

/** The clean K038 number inside a free-text string, or null. */
export function extractK038(value: unknown): string | null {
  const m = K038_NUMBER.exec(String(value ?? ''))
  return m ? `6105AK038-${m[1]}-${m[2].toUpperCase()}-${m[3]}` : null
}

/** The original K038 number for a row — filename first, title block second, else null. */
export function originalK038(r: Pick<CarryoverRow, 'legacy_docno' | 'ai_docno'>): string | null {
  return extractK038(r.legacy_docno) ?? extractK038(r.ai_docno)
}

/**
 * True when both sources carry a K038 number and they differ. The export does not try to
 * resolve these — it reports the filename and leaves the title-block value on the
 * Traceability sheet, so a human can see both and rule.
 */
export function k038Disagrees(r: Pick<CarryoverRow, 'legacy_docno' | 'ai_docno'>): boolean {
  const a = extractK038(r.legacy_docno)
  const b = extractK038(r.ai_docno)
  return !!a && !!b && a !== b
}
