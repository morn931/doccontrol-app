import { createClient } from '@supabase/supabase-js'

// Cross-project read-only client for CoreTime's shared Supabase project
// (ssyvxiqlcxfqomdklakr — also CostFlow's). CoreDocs has its own SEPARATE
// project; this is a live read, not a shared connection — same pattern
// coreflow-shell uses to read CoreDocs (see its docs-admin.ts).
function createCoreTimeClient() {
  const url = process.env.CORETIME_SUPABASE_URL
  const key = process.env.CORETIME_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// CoreTime project codes that ARE the K124 package, split A/B (confirmed
// with Liezl 2026-08-01): X146 = K124A (Phase 1 - EP, engineering), X153 =
// K124B (Phase 1 - CM, construction management). A name that isn't actively
// staffed on either shouldn't be selectable as a document owner on the K124
// board (e.g. Jaco Cornelius is PRDW/X147 staff, not K124).
const PHASE1_PROJECT_CODES = ['X146', 'X153']

export interface OwnerRosters {
  /** Actively staffed on X146/X153 (K124A/K124B) — a genuinely valid K124 owner. */
  phase1: Set<string>
  /**
   * Everyone active anywhere in the company (any project). Used to distinguish
   * "known PPE staff, just not on K124" (exclude — e.g. Jaco Cornelius on
   * PRDW/X147) from "not a PPE staff member at all" (can't disprove — e.g. an
   * RDMC reviewer — so don't exclude on roster grounds alone).
   */
  allStaff: Set<string>
}

/**
 * Cross-check data for the K124 Owner filter. Returns null (not empty sets)
 * if CoreTime isn't reachable — callers must treat null as "don't filter" so
 * a CoreTime hiccup never hides legitimate owners from the CoreDocs UI.
 */
export async function getOwnerRosters(): Promise<OwnerRosters | null> {
  const db = createCoreTimeClient()
  if (!db) return null
  try {
    const { data: projects, error: pErr } = await db
      .from('projects').select('id, code').in('code', PHASE1_PROJECT_CODES)
    if (pErr || !projects?.length) return null

    const projectIds = projects.map((p) => p.id as string)
    const { data: links, error: lErr } = await db
      .from('member_projects').select('member_id').in('project_id', projectIds)
    if (lErr) return null
    const phase1MemberIds = new Set((links ?? []).map((l) => l.member_id as string))

    const { data: members, error: mErr } = await db
      .from('company_members').select('id, full_name, is_active')
    if (mErr || !members) return null

    const activeMembers = members.filter((m) => m.is_active)
    return {
      phase1: new Set(
        activeMembers.filter((m) => phase1MemberIds.has(m.id as string))
          .map((m) => (m.full_name as string).trim()).filter(Boolean),
      ),
      allStaff: new Set(
        activeMembers.map((m) => (m.full_name as string).trim()).filter(Boolean),
      ),
    }
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Time & Leave — the signed-in engineer's own outstanding CoreTime items, for the
// Actions Cockpit. Ported verbatim from the shell's outstanding.ts (categories
// 3–5) so the two never disagree: weeks I still owe (own time not booked),
// timesheet approvals waiting on ME, and leave requests waiting on ME. Same
// payroll-boundary + 7-day-overdue rules agreed with Morné 2026-07-17.
// ─────────────────────────────────────────────────────────────────────────────

type CTClient = NonNullable<ReturnType<typeof createCoreTimeClient>>

export type TimeLeaveWeek = { weekStart: string; state: 'draft' | 'rejected' | 'missing' }
export type TimeLeaveApproval = { memberName: string; weekStart: string; entries: number; hours: number }
export type TimeLeaveRequest = {
  employeeName: string; leaveType: string | null; days: number; stage: 'manager' | 'final'; submittedAt: string | null
}
export type TimeAndLeave = {
  /** false = CoreTime env not set (panel shows a "connecting" state, not an error) */
  configured: boolean
  /** true once a live read succeeded (even if there's nothing outstanding) */
  ready: boolean
  weeks: TimeLeaveWeek[]
  approvals: TimeLeaveApproval[]
  leave: TimeLeaveRequest[]
  counts: { weeks: number; approvals: number; leave: number; total: number }
}

type TsRow = { id: string; member_id: string; week_start: string; status: string }
type MemberRow = { id: string; email: string | null; full_name: string | null; is_active: boolean; start_date: string | null; end_date: string | null }
type LeaveRow = {
  member_id: string; leave_type: string | null; status: string
  manager_id: string | null; final_approver_id: string | null; submitted_at: string | null
  employee: { full_name: string | null } | null
  leave_request_days: { hours: number | null }[] | null
}
type PendingApproval = { managerId: string | null; memberName: string; weekStart: string; hours: number }

/** Mondays from `from` (aligned forward) through the last FULL week before today. */
function mondaysBetween(from: string, today: string): string[] {
  const start = new Date(from + 'T00:00:00Z')
  const day = start.getUTCDay()
  start.setUTCDate(start.getUTCDate() + ((8 - (day || 7)) % 7))
  const out: string[] = []
  for (const d = start; ; d.setUTCDate(d.getUTCDate() + 7)) {
    const weekStart = d.toISOString().slice(0, 10)
    const weekEnd = new Date(d); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
    if (weekEnd.toISOString().slice(0, 10) >= today) break
    out.push(weekStart)
    if (out.length > 500) break
  }
  return out
}

// Outstanding weeks scoped to the CURRENT PAYROLL PERIOD (20th→19th) and only once
// 7+ days overdue — keeps the list realistic (agreed with Morné 2026-07-17).
function payrollPeriod(today: string): { start: string; end: string } {
  const d = new Date(today + 'T00:00:00Z')
  const day = d.getUTCDate()
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (day >= 20 ? 0 : 1), 20))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 19))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

function memberWeekGaps(m: MemberRow, sheets: TsRow[], today: string): TimeLeaveWeek[] {
  if (!m.is_active || !m.start_date) return []
  const horizon = m.end_date && m.end_date < today ? m.end_date : today
  const period = payrollPeriod(today)
  const byWeek = new Map(sheets.map((t) => [t.week_start, t.status]))
  const items: TimeLeaveWeek[] = []
  for (const week of mondaysBetween(m.start_date, horizon)) {
    const end = new Date(week + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 6)
    const weekEnd = end.toISOString().slice(0, 10)
    if (weekEnd < period.start || weekEnd > period.end) continue
    end.setUTCDate(end.getUTCDate() + 7)
    if (end.toISOString().slice(0, 10) > today) continue
    const status = byWeek.get(week)
    if (status === undefined) items.push({ weekStart: week, state: 'missing' })
    else if (status === 'draft') items.push({ weekStart: week, state: 'draft' })
    else if (status === 'rejected') items.push({ weekStart: week, state: 'rejected' })
  }
  return items
}

// Approvals window: from the previous month's 20th; resets to the current month's
// 20th on the 22nd (20th/21st are the payroll close-out grace days).
function approvalsWindowStart(today: string): string {
  const d = new Date(today + 'T00:00:00Z')
  const monthOffset = d.getUTCDate() >= 22 ? 0 : -1
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 20)).toISOString().slice(0, 10)
}

/** Submitted-and-waiting timesheet entries in the approvals window, attributed to their approving manager. */
async function fetchPendingApprovals(db: CTClient): Promise<PendingApproval[]> {
  const today = new Date().toISOString().slice(0, 10)
  const windowStart = approvalsWindowStart(today)
  const { data: allSheets } = await db
    .from('timesheets')
    .select('id, member_id, week_start, member:company_members!member_id(full_name)')
    .eq('status', 'submitted').limit(2000)
  const sheets = (allSheets ?? []).filter((s) => {
    const end = new Date((s.week_start as string) + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 6)
    return end.toISOString().slice(0, 10) >= windowStart
  })
  if (!sheets.length) return []
  const ids = sheets.map((s) => s.id)
  const [{ data: entries }, { data: par }, { data: ma }] = await Promise.all([
    db.from('timesheet_entries').select('timesheet_id, status, total_hours, cost_code:cost_codes(project_id)')
      .in('timesheet_id', ids).eq('status', 'submitted').limit(50000),
    db.from('project_approval_routing').select('project_id, member_id, manager_id').limit(5000),
    db.from('manager_assignments').select('member_id, manager_id').is('effective_to', null).limit(5000),
  ])
  const sheetById = new Map(sheets.map((s) => [s.id, s]))
  const routeByPair = new Map((par ?? []).map((r) => [`${r.member_id}:${r.project_id}`, r.manager_id as string]))
  const routeByMember = new Map((ma ?? []).map((r) => [r.member_id as string, r.manager_id as string]))
  return (entries ?? []).map((e) => {
    const rec = e as Record<string, unknown>
    const sheet = sheetById.get(rec.timesheet_id as string)
    const projectId = (rec.cost_code as Record<string, unknown> | null)?.project_id as string | undefined
    const memberId = (sheet?.member_id as string) ?? ''
    const managerId = (projectId && routeByPair.get(`${memberId}:${projectId}`)) || routeByMember.get(memberId) || null
    const member = sheet?.member as unknown as { full_name: string | null } | null
    return { managerId, memberName: member?.full_name ?? 'Unknown', weekStart: (sheet?.week_start as string) ?? '', hours: Number(rec.total_hours ?? 0) }
  })
}

/** Pending leave: 'submitted' waits on the manager, 'manager_approved' waits on the final approver. */
async function fetchPendingLeave(db: CTClient): Promise<LeaveRow[]> {
  const { data } = await db
    .from('leave_request')
    .select(`member_id, leave_type, status, manager_id, final_approver_id, submitted_at,
             employee:company_members!leave_request_member_id_fkey(full_name),
             leave_request_days(hours)`)
    .in('status', ['submitted', 'manager_approved']).limit(1000)
  return (data ?? []) as unknown as LeaveRow[]
}

function leaveItem(r: LeaveRow, stage: 'manager' | 'final'): TimeLeaveRequest {
  const days = r.leave_request_days ?? []
  return { employeeName: r.employee?.full_name ?? 'Unknown', leaveType: r.leave_type, days: days.length, stage, submittedAt: r.submitted_at }
}

export async function getTimeAndLeave(email: string): Promise<TimeAndLeave> {
  const db = createCoreTimeClient()
  const base: TimeAndLeave = { configured: !!db, ready: false, weeks: [], approvals: [], leave: [], counts: { weeks: 0, approvals: 0, leave: 0, total: 0 } }
  if (!db || !email) return base
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { data: me } = await db
      .from('company_members').select('id, email, full_name, is_active, start_date, end_date')
      .ilike('email', email).maybeSingle()
    if (!me) return { ...base, ready: true } // configured + reachable, just no CoreTime record for this email

    const [{ data: mySheets }, pending, pendingLeave] = await Promise.all([
      db.from('timesheets').select('id, member_id, week_start, status').eq('member_id', me.id).limit(2000),
      fetchPendingApprovals(db),
      fetchPendingLeave(db),
    ])

    const weeks = memberWeekGaps(me as MemberRow, (mySheets ?? []) as TsRow[], today)

    const mine = pending.filter((p) => p.managerId === (me.id as string))
    const byKey = new Map<string, TimeLeaveApproval>()
    for (const p of mine) {
      const k = `${p.memberName}:${p.weekStart}`
      let a = byKey.get(k)
      if (!a) { a = { memberName: p.memberName, weekStart: p.weekStart, entries: 0, hours: 0 }; byKey.set(k, a) }
      a.entries += 1; a.hours += p.hours
    }
    const approvals = [...byKey.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))

    const leave = pendingLeave
      .filter((r) => (r.status === 'submitted' && r.manager_id === me.id) || (r.status === 'manager_approved' && r.final_approver_id === me.id))
      .map((r) => leaveItem(r, r.status === 'submitted' ? 'manager' : 'final'))
      .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))

    return {
      configured: true, ready: true, weeks, approvals, leave,
      counts: { weeks: weeks.length, approvals: approvals.length, leave: leave.length, total: weeks.length + approvals.length + leave.length },
    }
  } catch {
    return base
  }
}
