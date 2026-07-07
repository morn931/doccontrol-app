/**
 * Per-package progress aggregation off the MDDR + review system.
 *
 * This is the single source of truth behind both the Package Progress Summary
 * report and the Engineering Tracker. It reproduces the workbook's
 * "Package_Progress_Summary" sheet:
 *   ActiveDocs, PlanToDateDocs, ApprovedDocs, ApprovalMatches, MissingDueDates,
 *   ActualProgressPct, PlannedProgressToDatePct, Variance, Source.
 *
 * Definitions (computed live):
 *   - ActiveDocs       = awarded MDDR rows for the package
 *   - ActualProgress%  = average Rules-of-Credit progress across those docs
 *   - PlanToDateDocs   = docs whose planned (due) date is on/before the "as of" date
 *   - Planned%         = PlanToDateDocs / ActiveDocs
 *   - ApprovedDocs     = docs with an A1 review outcome
 *   - ApprovalMatches  = docs matched to the live review system (any outcome)
 *   - MissingDueDates  = docs with no planned (due) date
 *   - Variance%        = Actual% − Planned%
 */

export interface PackageProgress {
  packageCode:         string
  activeDocs:          number
  excludedDocs:        number   // not tracked in the MDDR yet — always 0
  planToDateDocs:      number
  approvedDocs:        number
  approvalMatches:     number
  missingDueDates:     number
  actualProgressPct:   number   // 0..1
  actualThisPeriodPct: number   // 0..1 (period tracking not yet in MDDR — 0)
  plannedToDatePct:    number   // 0..1
  variancePct:         number   // actual − planned
  sources:             string[] // which registers contributed (SDDR/CDDL/MDDR)
}

export interface PackageProgressResult {
  rows:      PackageProgress[]
  total:     PackageProgress
  periodEnd: string
}

const z = (n: number, d: number) => (d ? n / d : 0)

export async function aggregatePackages(db: any, periodEnd: string): Promise<PackageProgressResult> {
  type Acc = {
    active: number; planToDate: number; approved: number; matches: number
    missingDue: number; prog: number; sources: Set<string>
  }
  const acc: Record<string, Acc> = {}
  const ensure = (c: string) => (acc[c] ??= {
    active: 0, planToDate: 0, approved: 0, matches: 0, missingDue: 0, prog: 0, sources: new Set(),
  })

  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('mddr_entries')
      .select('package_code, progress_percent, review_outcome_code, planned_completion_date, source_types')
      .eq('is_active', true).eq('is_awarded', true)
      .eq('is_deferred', false)      // current basis — deferred scope excluded (migration 012)
      .neq('source_type', 'INDEX')   // register docs only (exclude Document-Index sectors)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const code = r.package_code
      if (!code) continue
      const a = ensure(code)
      a.active++
      a.prog += Number(r.progress_percent ?? 0)
      if (r.review_outcome_code) a.matches++
      if (r.review_outcome_code === 'A1') a.approved++
      if (r.planned_completion_date) { if (r.planned_completion_date <= periodEnd) a.planToDate++ }
      else a.missingDue++
      for (const s of r.source_types ?? []) a.sources.add(s)
    }
    if (!data || data.length < 1000) break
  }

  const rows: PackageProgress[] = Object.entries(acc)
    .map(([code, a]) => {
      const actual = z(a.prog / 100, a.active)
      const planned = z(a.planToDate, a.active)
      return {
        packageCode: code,
        activeDocs: a.active, excludedDocs: 0, planToDateDocs: a.planToDate,
        approvedDocs: a.approved, approvalMatches: a.matches, missingDueDates: a.missingDue,
        actualProgressPct: actual, actualThisPeriodPct: 0, plannedToDatePct: planned,
        variancePct: actual - planned, sources: [...a.sources].sort(),
      }
    })
    .sort((x, y) => x.packageCode.localeCompare(y.packageCode))

  // TOTAL ACTIVE row — hours/doc-weighted where it makes sense (doc-count weighted here).
  const sum = rows.reduce((t, r) => {
    t.active += r.activeDocs; t.planToDate += r.planToDateDocs; t.approved += r.approvedDocs
    t.matches += r.approvalMatches; t.missingDue += r.missingDueDates
    t.progWeighted += r.actualProgressPct * r.activeDocs
    return t
  }, { active: 0, planToDate: 0, approved: 0, matches: 0, missingDue: 0, progWeighted: 0 })

  const totalActual = z(sum.progWeighted, sum.active)
  const totalPlanned = z(sum.planToDate, sum.active)
  const total: PackageProgress = {
    packageCode: 'TOTAL ACTIVE',
    activeDocs: sum.active, excludedDocs: 0, planToDateDocs: sum.planToDate,
    approvedDocs: sum.approved, approvalMatches: sum.matches, missingDueDates: sum.missingDue,
    actualProgressPct: totalActual, actualThisPeriodPct: 0, plannedToDatePct: totalPlanned,
    variancePct: totalActual - totalPlanned, sources: [],
  }

  return { rows, total, periodEnd }
}
