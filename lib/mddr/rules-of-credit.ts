/**
 * Rules of Credit — Reko Diq engineering progress measurement.
 *
 * Agreed with Siemens Energy (Khawaja M. Zubair) on the "Primary & Secondary
 * Drawings Weightage" thread, concluded 4 Jun 2026. A simplified four-milestone
 * basis is applied to EVERY deliverable in the register ("right through the bank"):
 *
 *   1. Controlled first submission accepted into the doc-control workflow .... 25%
 *   2. Technically reviewable / developed submission (a formal PPE/RDMC review
 *      cycle completed, returned with comments or a proceed-type outcome, and
 *      NOT rejected as incomplete / below standard) ........................... 75%
 *   3. Accepted for current project use (PPE/RDMC A1 outcome) ................. 85%
 *   4. Final IFC / IFD issue (final numerical revision, Rev 0 or higher,
 *      accepted) ............................................................. 100%
 *
 * The credit values are kept here as the single source of truth so the basis can
 * be re-tuned without hunting through the codebase.
 */

export const RULES_OF_CREDIT = {
  NONE:              { milestone: 0, percent: 0,   label: 'Not started' },
  FIRST_SUBMISSION:  { milestone: 1, percent: 25,  label: 'Submitted into workflow' },
  REVIEWED:          { milestone: 2, percent: 75,  label: 'Reviewed (with comments / proceed)' },
  ACCEPTED:          { milestone: 3, percent: 85,  label: 'Accepted for use (A1)' },
  FINAL_ISSUE:       { milestone: 4, percent: 100, label: 'Final IFC / IFD issue' },
} as const

export type RuleOfCreditStage = keyof typeof RULES_OF_CREDIT

/** Outcome codes that mean a review cycle was completed but the doc still
 *  proceeds (milestone 2). D1/B1/B2 = approved-with-comments / proceed types. */
const PROCEED_OUTCOMES = new Set(['D1', 'B1', 'B2'])
/** Outcome codes that are rejections / incomplete — do NOT earn beyond submission. */
const REJECT_OUTCOMES = new Set(['C1', 'Q1'])

/** Worst-case severity order used elsewhere in the app (best → worst). */
const SEVERITY_ORDER = ['A1', 'D1', 'B1', 'B2', 'C1', 'Q1', 'V1', 'S1']

/** Pick the worst-case (most restrictive) outcome across all reviewers, mirroring
 *  the transmittal logic. Returns null if no outcomes. */
export function worstCaseOutcome(codes: (string | null | undefined)[]): string | null {
  let worst: string | null = null
  let worstRank = -1
  for (const c of codes) {
    if (!c) continue
    const rank = SEVERITY_ORDER.indexOf(c)
    if (rank > worstRank) { worstRank = rank; worst = c }
  }
  return worst
}

/** A revision is "numerical" (Rev 0, 1, 2 …) once it leaves the alphabetical
 *  draft series (A, B, C …). Numerical revisions denote IFC/IFD-grade issues. */
export function isNumericRevision(rev: string | null | undefined): boolean {
  if (rev == null) return false
  return /^\d+$/.test(String(rev).trim())
}

export interface ProgressInput {
  /** Has the document been submitted into the doc-control workflow at all?
   *  (i.e. a batch / document version exists for it). */
  hasSubmission: boolean
  /** Worst-case review outcome code of the latest version, if a review completed. */
  latestOutcome?: string | null
  /** Latest known revision (alpha A/B/C… or numeric 0/1/2…). */
  latestRevision?: string | null
}

export interface ProgressResult {
  stage:     RuleOfCreditStage
  milestone: number
  percent:   number
  label:     string
}

/**
 * Compute the Rules-of-Credit progress for a single deliverable from its current
 * review-system state.
 */
export function computeProgress(input: ProgressInput): ProgressResult {
  const { hasSubmission, latestOutcome, latestRevision } = input

  if (!hasSubmission) return finalize('NONE')

  const outcome = latestOutcome ?? null

  // Milestone 3 / 4 — accepted (A1)
  if (outcome === 'A1') {
    return finalize(isNumericRevision(latestRevision) ? 'FINAL_ISSUE' : 'ACCEPTED')
  }

  // Milestone 2 — reviewed and proceeding (with comments)
  if (outcome && PROCEED_OUTCOMES.has(outcome)) {
    return finalize('REVIEWED')
  }

  // Rejected / incomplete, or voided — stays at first-submission credit only.
  if (outcome && REJECT_OUTCOMES.has(outcome)) {
    return finalize('FIRST_SUBMISSION')
  }
  if (outcome === 'V1' || outcome === 'S1') {
    return finalize('NONE')
  }

  // Submitted but no completed review yet.
  return finalize('FIRST_SUBMISSION')
}

function finalize(stage: RuleOfCreditStage): ProgressResult {
  const r = RULES_OF_CREDIT[stage]
  return { stage, milestone: r.milestone, percent: r.percent, label: r.label }
}
