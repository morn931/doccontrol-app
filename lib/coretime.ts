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

/**
 * Full names of everyone actively staffed on the Phase 1 projects (X146 +
 * X153) in CoreTime. Returns null (not an empty set) if CoreTime isn't
 * reachable — callers must treat null as "don't filter" so a CoreTime hiccup
 * never hides legitimate owners from the CoreDocs UI.
 */
export async function getPhase1OwnerRoster(): Promise<Set<string> | null> {
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

    const memberIds = [...new Set((links ?? []).map((l) => l.member_id as string))]
    if (!memberIds.length) return null

    const { data: members, error: mErr } = await db
      .from('company_members').select('full_name, is_active').in('id', memberIds)
    if (mErr) return null

    return new Set(
      (members ?? [])
        .filter((m) => m.is_active)
        .map((m) => (m.full_name as string).trim())
        .filter(Boolean),
    )
  } catch {
    return null
  }
}
