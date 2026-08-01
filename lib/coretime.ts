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
