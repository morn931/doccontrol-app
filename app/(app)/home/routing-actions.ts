'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function me() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await createServiceClient()
    .from('users').select('email, full_name').eq('auth_user_id', user.id).single()
  return profile?.email ? { email: profile.email as string, name: (profile.full_name as string) ?? null } : null
}

export type RouteInput = {
  toEmail: string
  toName?: string | null
  documentVersionId?: string | null
  batchId?: string | null
  documentNumber?: string | null
  packageCode?: string | null
  note?: string | null
}

// Route a document (or a whole batch) to another reviewer — a collaboration
// hand-off that appears on their cockpit. Does not touch the formal review chain.
export async function routeItem(input: RouteInput): Promise<{ ok: boolean; error?: string }> {
  const from = await me()
  if (!from) return { ok: false, error: 'Not signed in.' }
  const toEmail = String(input.toEmail ?? '').trim().toLowerCase()
  if (!toEmail || !/^[^@\s]+@[^@\s]+$/.test(toEmail)) return { ok: false, error: 'Pick a reviewer to route to.' }
  if (toEmail === from.email.toLowerCase()) return { ok: false, error: "That's you — pick someone else." }
  if (!input.documentVersionId && !input.batchId) return { ok: false, error: 'Nothing to route.' }
  try {
    const { error } = await createServiceClient().from('document_routing').insert({
      from_email: from.email,
      from_name: from.name,
      to_email: toEmail,
      to_name: input.toName ?? null,
      document_version_id: input.documentVersionId ?? null,
      batch_id: input.batchId ?? null,
      document_number: input.documentNumber ?? null,
      package_code: input.packageCode ?? null,
      note: input.note?.trim() || null,
    })
    if (error) {
      // Table not created yet → a clear, actionable message rather than a crash.
      if (/relation .*document_routing.* does not exist/i.test(error.message)) {
        return { ok: false, error: 'Routing isn’t switched on yet (migration 043 pending).' }
      }
      return { ok: false, error: error.message }
    }
    revalidatePath('/home')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Recipient responds to a routing (accept it into their work, mark done, or dismiss).
export async function respondRouting(id: string, status: 'accepted' | 'done' | 'dismissed'): Promise<{ ok: boolean; error?: string }> {
  const who = await me()
  if (!who) return { ok: false, error: 'Not signed in.' }
  if (!['accepted', 'done', 'dismissed'].includes(status)) return { ok: false, error: 'Bad status.' }
  try {
    const db = createServiceClient()
    // Only the recipient may respond.
    const { data: row } = await db.from('document_routing').select('to_email').eq('id', id).maybeSingle()
    if (!row) return { ok: false, error: 'Routing not found.' }
    if (String(row.to_email).toLowerCase() !== who.email.toLowerCase()) return { ok: false, error: 'This routing isn’t addressed to you.' }
    await db.from('document_routing').update({
      status, responded_at: new Date().toISOString(), responded_by_email: who.email,
    }).eq('id', id)
    revalidatePath('/home')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
