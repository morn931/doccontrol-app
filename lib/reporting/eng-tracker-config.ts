/**
 * Engineering Tracker — static configuration captured from
 * "Engineering_Tracker_CLIENT_READY_updated 29 April 2026.xlsx" → sheet
 * "Engineering Tracker".
 *
 * The budget hours (orig/approved-change) are manual inputs maintained in that
 * workbook; everything else in the report is computed live from the MDDR + the
 * review system. Edit these values here (or later move to a DB table) when the
 * budget basis changes.
 */

export interface TrackerPackage {
  code:        string   // matches mddr_entries.package_code
  description: string   // as shown in the tracker
  origBudget:  number   // ORIG BUDGET HOURS
  apprChg?:    number   // APPROVED CHANGE HOURS
  /** K124 is the CDDL "control line" — its current budget is taken as-is, not
   *  rescaled to staffed hours like the contractor packages. */
  controlLine?: boolean
}

export interface TrackerSection {
  title:    string
  packages: TrackerPackage[]
}

export const ENG_TRACKER_SECTIONS: TrackerSection[] = [
  {
    title: 'Engineering',
    packages: [
      { code: 'K125', description: '6240- K125 - 220kV Transmission Substations',           origBudget: 18898 },
      { code: 'K137', description: 'K137-OHL - 220 kV & 33kV Overhead Lines',                origBudget: 8488 },
      { code: 'E101', description: '6262-E101 - 36MVA Emergency Power Generation',           origBudget: 20712 },
      { code: 'E102', description: '6253-E102 - Synchronous Condensers',                     origBudget: 9397 },
      { code: 'E121', description: '6243-E121 - Concentrator 33 kV GIS Substation',          origBudget: 2211 },
      { code: 'E122', description: '6286-E122 - Mining Substation 33/11 kV',                 origBudget: 3740 },
      { code: 'E123', description: '6251-E123 - 11kV / 20MW Load Bank',                      origBudget: 6078 },
      { code: 'E103', description: '6252-E103 - HV Harmonic Filters',                        origBudget: 3863 },
      { code: 'K108', description: '6254-K108 - Battery Energy Storage System (BESS)',       origBudget: 9457 },
      { code: 'K110', description: '6291-K110 - Solar PV Plant',                             origBudget: 5321 },
      { code: 'K124', description: 'K124 - PPE Phase 1 Engineering Deliverables (CDDL control line)', origBudget: 53700, controlLine: true },
    ],
  },
  {
    title: 'Engineering Contracts',
    packages: [
      { code: 'K-001', description: 'K-001 Project Fuel Supply',                         origBudget: 0 },
      { code: 'K-002', description: 'K-002 Supply of Explosives and Blasting Services',  origBudget: 0 },
      { code: 'K-003', description: 'K-003 Fire Detection Systems',                      origBudget: 0 },
      { code: 'K-004', description: 'K-004 Truck Shop & Mine Admin Building',            origBudget: 0 },
      { code: 'K-006', description: 'K-006 Power Supply to Substation',                  origBudget: 0 },
    ],
  },
]

/** Links sheet inputs (EVM staffing model). */
export const ENG_TRACKER_LINKS = {
  /** Planned staffed hours at end of project (Links!B6). The contractor packages'
   *  current budget is the deliverable-hour share of this figure. */
  plannedStaffedHoursEOP: 16050,
  periodStart: '2025-05-01',
  periodEnd:   '2026-02-28',
}

/** Total deliverable hours across all packages (== Links!B13). Derived from the
 *  config so it always matches the sum of the package budgets. */
export const TOTAL_DELIVERABLE_HOURS = ENG_TRACKER_SECTIONS
  .flatMap(s => s.packages)
  .reduce((sum, p) => sum + (p.origBudget + (p.apprChg ?? 0)), 0)

export const ALL_TRACKER_PACKAGES = ENG_TRACKER_SECTIONS.flatMap(s => s.packages.map(p => p.code))
