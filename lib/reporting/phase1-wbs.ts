/**
 * PPE Phase 1 Engineering Deliverables — WBS roll-up.
 *
 * Replicates the "Summary" sheet of the Phase 1 Engineering Deliverables Tracker:
 * grouped by WBS code (CDDL "Area/ WBS No."), sourced from the PPE CDDL only.
 *
 * Per-document progress uses the tracker's 3-milestone basis (each = 1/3):
 *   1. Rev A submitted  — issued for review (or a Rev A transmittal recorded)
 *   2. Rev 0 submitted  — numerical revision / issued for construction/use
 *   3. Approved         — issued for construction/use, or an A1 review outcome
 * → per-doc completion ∈ {0, 33%, 67%, 100%}.
 *
 * Placeholders ("RES - Reserved Placeholder" / "No Placeholder Yet") count as
 * 0% and are reported separately, mirroring the sheet's Total Docs / Placeholders
 * and the two completion measures (overall, and excluding placeholders).
 */

export const WBS_NAMES: Record<string, string> = {
  '0000': 'General',
  '0100': 'Project Site Wide',
  '6186': 'Support Facilities',
  '6200': 'On-Site Power Supply and Transmission',
  '6210': 'Power Stations',
  '6240': 'High Voltage Substations',
  '6241': '33/220 kV Solar PV Substation',
  '6242': '33/220 kV Power Station Substation',
  '6243': '220/33 kV Plant Main Substation',
  '6250': 'Power Conditioning Equipment',
  '6251': 'Load Bank',
  '6260': 'Emergency Power Generation',
  '6262': 'Emergency Power Substation 1 and Control Room 1',
  '6263': '36 MVA Power Station 1',
  '6264': 'Bulk Diesel Storage 1',
  '6280': 'Medium Voltage (33 kV) Overhead Powerlines',
  '6282': 'Borefields',
  '6286': 'Mining Open Pit',
  '6290': 'Renewable Energy',
  '6292': '11/33 kV Solar PV Substation 1 and Control Room 1',
  '7337': 'Port Qasim PIBT Control Room',
}

const PLACEHOLDER_STATUSES = new Set(['RES - Reserved Placeholder', 'No Placeholder Yet'])
const ISSUED = (s: string) => /^IF[RDCU]/i.test(s)            // IFR / IFD / IFC / IFU
const FOR_USE = (s: string) => /^IF[CU]/i.test(s)            // IFC / IFU (construction/use)

export interface CddlDoc {
  wbs_code: string | null
  aconex_doc_status: string | null
  actual_submission_date: string | null
  actual_completion_date: string | null
  review_outcome_code: string | null
  revision: string | null
}

export interface DocProgress { placeholder: boolean; pct: number }

export function cddlDocProgress(d: CddlDoc): DocProgress {
  const status = (d.aconex_doc_status ?? '').trim()
  const placeholder = !status || PLACEHOLDER_STATUSES.has(status)
  if (placeholder) return { placeholder: true, pct: 0 }

  const numericRev = /^\d+$/.test((d.revision ?? '').trim())
  const m1 = ISSUED(status) || !!d.actual_submission_date
  const m2 = numericRev || !!d.actual_completion_date || FOR_USE(status)
  const m3 = FOR_USE(status) || d.review_outcome_code === 'A1'
  return { placeholder: false, pct: (Number(m1) + Number(m2) + Number(m3)) / 3 }
}

export interface WbsRow {
  wbs:                 string
  name:                string
  totalDocs:           number
  placeholders:        number
  activeDocs:          number   // total − placeholders
  completionOverall:   number   // 0..1, avg over ALL docs (placeholders = 0)
  completionExclPlace: number   // 0..1, avg over started docs (pct > 0)
}

export interface Phase1Result {
  rows:  WbsRow[]
  total: WbsRow
}

export async function aggregatePhase1Wbs(db: any): Promise<Phase1Result> {
  type Acc = { total: number; placeholders: number; sumAll: number; sumStarted: number; started: number }
  const acc: Record<string, Acc> = {}

  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('mddr_entries')
      .select('wbs_code, aconex_doc_status, actual_submission_date, actual_completion_date, review_outcome_code, revision')
      .eq('source_type', 'CDDL')
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const wbs = (r.wbs_code ?? '—').toString().trim() || '—'
      const a = (acc[wbs] ??= { total: 0, placeholders: 0, sumAll: 0, sumStarted: 0, started: 0 })
      const p = cddlDocProgress(r)
      a.total++
      if (p.placeholder) a.placeholders++
      a.sumAll += p.pct
      if (p.pct > 0) { a.sumStarted += p.pct; a.started++ }
    }
    if (!data || data.length < 1000) break
  }

  const rows: WbsRow[] = Object.entries(acc).map(([wbs, a]) => ({
    wbs,
    name: WBS_NAMES[wbs] ?? '',
    totalDocs: a.total,
    placeholders: a.placeholders,
    activeDocs: a.total - a.placeholders,
    completionOverall: a.total ? a.sumAll / a.total : 0,
    completionExclPlace: a.started ? a.sumStarted / a.started : 0,
  })).sort((x, y) => x.wbs.localeCompare(y.wbs))

  const t = rows.reduce((s, r) => {
    s.total += r.totalDocs; s.place += r.placeholders; s.active += r.activeDocs
    s.sumAll += r.completionOverall * r.totalDocs
    s.sumStarted += r.completionExclPlace * (r.totalDocs - r.placeholders)
    return s
  }, { total: 0, place: 0, active: 0, sumAll: 0, sumStarted: 0 })

  const total: WbsRow = {
    wbs: 'TOTAL', name: '',
    totalDocs: t.total, placeholders: t.place, activeDocs: t.active,
    completionOverall: t.total ? t.sumAll / t.total : 0,
    completionExclPlace: t.active ? t.sumStarted / t.active : 0,
  }

  return { rows, total }
}
