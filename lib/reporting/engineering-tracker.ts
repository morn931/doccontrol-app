/**
 * Engineering Tracker calculation engine.
 *
 * Replicates the workbook's Engineering Tracker, recomputing all progress columns
 * live from the MDDR + review system. Two ratio corrections vs the spreadsheet:
 *
 *  - % OF DISCPL: the sheet used active-document COUNT share; we use BUDGET-HOUR
 *    share (D / Σ discipline D), consistent with the hours/EVM basis of the rest
 *    of the report. Set `pctBasis: 'docs'` to reproduce the old behaviour.
 *  - % OF PROJ: the sheet divided by an empty cell (always 0 — a bug). We divide
 *    by the grand-total budget hours.
 *
 * Subtotals/grand totals hours-weight the actual & planned %, which is the correct
 * EVM roll-up (Σ earned hours / Σ budget hours), rather than a simple average.
 */
import {
  ENG_TRACKER_SECTIONS, ENG_TRACKER_LINKS, TOTAL_DELIVERABLE_HOURS,
  type TrackerPackage,
} from './eng-tracker-config'

/** Per-package figures sourced from the MDDR + review system (fractions 0..1). */
export interface PackageStat {
  activeDocs:   number
  approvedDocs: number
  actualPct:    number   // average Rules-of-Credit progress across the package
  plannedPct:   number   // share of docs whose planned date is on/before period end
  periodPct:    number   // progress earned in the current period
  note?:        string
}

export type RowKind = 'section' | 'package' | 'subtotal' | 'grand'

export interface TrackerRow {
  kind:         RowKind
  code?:        string
  description:  string
  // RATIOS
  pctDiscpl:    number
  pctProj:      number
  // BUDGET HR DATA
  origBudget:   number
  apprChg:      number
  currentBudget:number
  earnedPeriod: number
  earnedToDate: number
  baseToGo:     number
  fcstToGo:     number
  fcstEopHrs:   number
  // EXPENDED HOURS
  expThisPeriod:number
  expToDate:    number
  expFcstEop:   number
  expPctToDate: number
  // PERFORMANCE
  perfPeriod:   number
  perfToDate:   number
  perfFcstToGo: number
  perfFcstEop:  number
  // PROGRESS DATA
  progToDatePlan: number
  progToDateAct:  number
  progVar:        number
  note:           string
}

export interface BuildOptions {
  pctBasis?: 'hours' | 'docs'       // % OF DISCPL basis (default hours)
  plannedStaffedHoursEOP?: number
}

const z = (n: number) => (isFinite(n) ? n : 0)

function blankRow(kind: RowKind, description: string): TrackerRow {
  return {
    kind, description,
    pctDiscpl: 0, pctProj: 0,
    origBudget: 0, apprChg: 0, currentBudget: 0, earnedPeriod: 0, earnedToDate: 0,
    baseToGo: 0, fcstToGo: 0, fcstEopHrs: 0,
    expThisPeriod: 0, expToDate: 0, expFcstEop: 0, expPctToDate: 0,
    perfPeriod: 0, perfToDate: 0, perfFcstToGo: 0, perfFcstEop: 0,
    progToDatePlan: 0, progToDateAct: 0, progVar: 0, note: '',
  }
}

function packageRow(
  p: TrackerPackage, stat: PackageStat,
  totals: { disciplineBudget: number; grandBudget: number; docCount: number; disciplineDocs: number },
  opts: Required<BuildOptions>,
): TrackerRow {
  const D = p.origBudget
  const E = p.apprChg ?? 0
  const budgetBase = D + E
  // Current budget: control line taken as-is; others = staffed-hours share.
  const F = p.controlLine
    ? budgetBase
    : opts.plannedStaffedHoursEOP * z(budgetBase / TOTAL_DELIVERABLE_HOURS)

  const a  = stat.actualPct
  const pl = stat.plannedPct
  const pp = stat.periodPct

  const H = F * a            // earned to date
  const G = F * pp           // earned this period
  const J = Math.max(0, F - H)

  const pctDiscpl = opts.pctBasis === 'docs'
    ? z(stat.activeDocs / totals.disciplineDocs)
    : z(budgetBase / totals.disciplineBudget)

  return {
    kind: 'package', code: p.code, description: p.description,
    pctDiscpl, pctProj: z(budgetBase / totals.grandBudget),
    origBudget: D, apprChg: E, currentBudget: F,
    earnedPeriod: G, earnedToDate: H, baseToGo: F - H, fcstToGo: J, fcstEopHrs: H + J,
    expThisPeriod: G, expToDate: H, expFcstEop: H + J, expPctToDate: z(H / F),
    perfPeriod: pp, perfToDate: a, perfFcstToGo: Math.max(0, 1 - a), perfFcstEop: 1,
    progToDatePlan: pl, progToDateAct: a, progVar: a - pl,
    note: stat.note ?? '',
  }
}

function aggregate(kind: RowKind, description: string, rows: TrackerRow[], grandBudget: number): TrackerRow {
  const r = blankRow(kind, description)
  for (const x of rows) {
    r.origBudget += x.origBudget; r.apprChg += x.apprChg; r.currentBudget += x.currentBudget
    r.earnedPeriod += x.earnedPeriod; r.earnedToDate += x.earnedToDate
    r.baseToGo += x.baseToGo; r.fcstToGo += x.fcstToGo; r.fcstEopHrs += x.fcstEopHrs
    r.expThisPeriod += x.expThisPeriod; r.expToDate += x.expToDate; r.expFcstEop += x.expFcstEop
  }
  // Hours-weighted roll-ups
  r.pctDiscpl = 1
  r.pctProj = z((r.origBudget + r.apprChg) / grandBudget)
  r.expPctToDate = z(r.expToDate / r.currentBudget)
  r.perfToDate = z(r.earnedToDate / r.currentBudget)
  r.perfPeriod = z(r.earnedPeriod / r.currentBudget)
  r.perfFcstToGo = Math.max(0, 1 - r.perfToDate)
  r.perfFcstEop = 1
  r.progToDateAct = r.perfToDate
  r.progToDatePlan = z(rows.reduce((s, x) => s + x.currentBudget * x.progToDatePlan, 0) / r.currentBudget)
  r.progVar = r.progToDateAct - r.progToDatePlan
  return r
}

/**
 * Build the full tracker. `stats` is keyed by package code; missing packages get
 * zeroed rows (e.g. "no register yet").
 */
export function buildTracker(
  stats: Record<string, PackageStat>, options: BuildOptions = {},
): { rows: TrackerRow[]; grand: TrackerRow } {
  const opts: Required<BuildOptions> = {
    pctBasis: options.pctBasis ?? 'hours',
    plannedStaffedHoursEOP: options.plannedStaffedHoursEOP ?? ENG_TRACKER_LINKS.plannedStaffedHoursEOP,
  }

  const grandBudget = TOTAL_DELIVERABLE_HOURS || 1
  const out: TrackerRow[] = []
  const sectionSubtotals: TrackerRow[] = []

  for (const section of ENG_TRACKER_SECTIONS) {
    out.push({ ...blankRow('section', section.title) })
    const disciplineBudget = section.packages.reduce((s, p) => s + p.origBudget + (p.apprChg ?? 0), 0) || 1
    const disciplineDocs   = section.packages.reduce((s, p) => s + (stats[p.code]?.activeDocs ?? 0), 0) || 1

    const pkgRows = section.packages.map(p => {
      const stat = stats[p.code] ?? { activeDocs: 0, approvedDocs: 0, actualPct: 0, plannedPct: 0, periodPct: 0, note: 'No register loaded' }
      return packageRow(p, stat, { disciplineBudget, grandBudget, docCount: 0, disciplineDocs }, opts)
    })
    out.push(...pkgRows)
    const sub = aggregate('subtotal', `SUBTOTAL - ${section.title}`, pkgRows, grandBudget)
    out.push(sub)
    sectionSubtotals.push(sub)
  }

  const grand = aggregate('grand', 'GRAND TOTAL', sectionSubtotals, grandBudget)
  out.push(grand)
  return { rows: out, grand }
}
