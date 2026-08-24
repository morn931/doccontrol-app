'use server'
import { revalidatePath } from 'next/cache'
import { createServiceClient, createClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { DECISION_FIELDS, type DecisionField } from '@/lib/carryover/carryover'

// Saving a document controller's decision.
//
// Only the DECISION fields are writable. Provenance is scanner-owned and the ai_* columns
// are the reader's record of what the document actually says — if the register could
// overwrite those, the audit trail that lets someone check a decision against the document
// would be gone. The allow-list is enforced here, not trusted from the client.

const WRITABLE = new Set<string>(DECISION_FIELDS)

async function gate() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not signed in' }
  const { data: profile } = await createServiceClient()
    .from('users').select('role').eq('email', user.email!).maybeSingle()
  const perms = await getPermissions(auth)
  // Editing the carry-over register is the same job as editing the CDDL, so it rides on
  // the permission document control already have rather than inventing a new one.
  if (!can(perms, FK.ACTION_EDIT_CDDL, (profile?.role ?? 'reviewer') as string)) {
    return { ok: false as const, error: 'You do not have permission to edit the CDDL' }
  }
  return { ok: true as const, email: user.email ?? null }
}

export async function saveDecision(
  tempRef: string,
  patch: Partial<Record<DecisionField, string>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate()
  if (!g.ok) return g

  const bad = Object.keys(patch).filter((k) => !WRITABLE.has(k))
  if (bad.length) return { ok: false, error: `Not an editable field: ${bad.join(', ')}` }
  if (!tempRef.trim()) return { ok: false, error: 'Missing reference' }

  // Empty means "cleared", which is different from "untouched" — store null so the export
  // writes a blank cell rather than the literal "".
  const clean: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(patch)) clean[k] = v?.trim() ? v.trim() : null

  const { error } = await createServiceClient()
    .from('cddl_carryover')
    .update({ ...clean, decided_by: g.email, decided_at: new Date().toISOString() })
    .eq('temp_ref', tempRef)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/cddl-carryover')
  return { ok: true }
}

export async function setStatus(
  tempRef: string,
  status: 'pending' | 'done' | 'skipped',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate()
  if (!g.ok) return g
  const { error } = await createServiceClient()
    .from('cddl_carryover')
    .update({ status, decided_by: g.email, decided_at: new Date().toISOString() })
    .eq('temp_ref', tempRef)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/cddl-carryover')
  return { ok: true }
}
