import { isReady, type CarryoverRow } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS AND PACE ON THE CARRY-OVER.
//
// ⚠️ READ THIS BEFORE QUOTING THE TIME FIGURE AT ANYONE.
//
// `decided_at` records WHEN A DECISION WAS SAVED. It is not a timesheet. Opening a
// drawing, reading its title block, checking it against the MDDR and deciding what number
// it should carry all happen BETWEEN saves and leave no trace here. "Active" below is
// therefore the time BRACKETED BY consecutive saves — a lower bound on effort that
// silently excludes:
//   · everything before the first save of a session (often the longest part: finding and
//     opening the document);
//   · any document opened, considered and left undecided — the 156 with no project border
//     are exactly the ones most likely to be looked at and deferred;
//   · work on this register done through any other surface.
//
// It is a fair measure of THROUGHPUT and a poor measure of DILIGENCE. Presented as the
// latter it will be wrong, and wrong about named people.
//
// `updated_at` is deliberately NOT used: the AI reader wrote to every one of the 528 rows
// when it read the documents, so by that column the register is 100% "touched" and always
// has been.
// ─────────────────────────────────────────────────────────────────────────────

/** A gap longer than this ends a working session. */
const SESSION_GAP_MS = 30 * 60 * 1000
/** The working day the pace is expressed against. */
export const WORKING_DAY_HOURS = 9

export type PersonDay = { day: string; decisions: number; activeMs: number; spanMs: number; first: string; last: string; sessions: number }
export type PersonPace = { email: string; name: string; decisions: number; activeMs: number; days: PersonDay[] }
export type CarryoverProgress = {
  total: number; ready: number; partial: number; untouched: number
  withNumber: number; withArea: number
  decided: number
  people: PersonPace[]
  /** decisions per calendar day on which anything was decided */
  byDay: { day: string; decisions: number }[]
  /** decisions on the most recent active day */
  latestDayRate: number
  /** mean decisions per active day */
  meanRate: number
  /** median seconds between consecutive saves inside a session — time per document */
  medianGapSec: number
  remaining: number
  /** working days left at the latest-day rate, and at the mean */
  daysAtLatest: number | null
  daysAtMean: number | null
  noBorderRemaining: number
  unreadRemaining: number
}

const nameOf = (email: string) => {
  const local = String(email ?? '').split('@')[0]
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Unknown'
}

export function getProgress(rows: CarryoverRow[]): CarryoverProgress {
  const has = (v: unknown) => !!String(v ?? '').trim()
  const total = rows.length
  const ready = rows.filter(isReady).length
  const withNumber = rows.filter((r) => has(r.docno)).length
  const withArea = rows.filter((r) => has(r.wbs)).length
  const partial = rows.filter((r) => !isReady(r) && (has(r.docno) || has(r.wbs))).length

  const decidedRows = rows.filter((r) => has(r.decided_by) && r.decided_at)
  const byPerson = new Map<string, number[]>()
  for (const r of decidedRows) {
    const t = new Date(r.decided_at as string).getTime()
    if (!Number.isFinite(t)) continue
    const list = byPerson.get(r.decided_by as string) ?? []
    list.push(t)
    byPerson.set(r.decided_by as string, list)
  }

  const gaps: number[] = []
  const people: PersonPace[] = []
  for (const [email, tsRaw] of byPerson) {
    const ts = [...tsRaw].sort((a, b) => a - b)
    const perDay = new Map<string, number[]>()
    for (const t of ts) {
      const d = new Date(t).toISOString().slice(0, 10)
      perDay.set(d, [...(perDay.get(d) ?? []), t])
    }
    const days: PersonDay[] = []
    let activeMs = 0
    for (const [day, listRaw] of [...perDay.entries()].sort()) {
      const list = [...listRaw].sort((a, b) => a - b)
      let active = 0, sessions = 1
      for (let i = 1; i < list.length; i++) {
        const g = list[i] - list[i - 1]
        if (g <= SESSION_GAP_MS) { active += g; gaps.push(g) } else sessions++
      }
      activeMs += active
      days.push({
        day, decisions: list.length, activeMs: active,
        spanMs: list[list.length - 1] - list[0],
        first: new Date(list[0]).toISOString(),
        last: new Date(list[list.length - 1]).toISOString(),
        sessions,
      })
    }
    people.push({ email, name: nameOf(email), decisions: ts.length, activeMs, days })
  }
  people.sort((a, b) => b.decisions - a.decisions)

  const dayMap = new Map<string, number>()
  for (const r of decidedRows) {
    const d = String(r.decided_at).slice(0, 10)
    dayMap.set(d, (dayMap.get(d) ?? 0) + 1)
  }
  const byDay = [...dayMap.entries()].sort().map(([day, decisions]) => ({ day, decisions }))
  const latestDayRate = byDay.length ? byDay[byDay.length - 1].decisions : 0
  const meanRate = byDay.length ? decidedRows.length / byDay.length : 0
  gaps.sort((a, b) => a - b)
  const medianGapSec = gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] / 1000) : 0
  const remaining = total - ready

  return {
    total, ready, partial, untouched: total - ready - partial,
    withNumber, withArea, decided: decidedRows.length,
    people, byDay, latestDayRate, meanRate, medianGapSec, remaining,
    daysAtLatest: latestDayRate > 0 ? remaining / latestDayRate : null,
    daysAtMean: meanRate > 0 ? remaining / meanRate : null,
    noBorderRemaining: rows.filter((r) => !isReady(r) && r.ai_has_border === false).length,
    unreadRemaining: rows.filter((r) => !isReady(r) && (!r.ai_read_at || has(r.ai_error))).length,
  }
}
