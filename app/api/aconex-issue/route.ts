import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'

// The Aconex issue queue: every completed internal (Rev 0/IFC) and As-Built
// document awaiting its tracked-manual upload to Aconex, plus the issued log.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const { data: rows } = await db.from('aconex_issue')
    .select('id, batch_id, document_version_id, source, rdmc_document_number, revision, aconex_document_ref, cddl_updated, issued_by_email, issued_at, status, notes, created_at')
    .order('status', { ascending: false })      // pending first
    .order('created_at', { ascending: true })
    .limit(1000)
  return NextResponse.json({ rows: rows ?? [] })
}

// Mark one or more queue rows as issued to Aconex — the tracked-manual step:
// Doc Control uploads in Aconex as always, then records the transmittal ref
// here (+ the CDDL/MDDR-updated tick). Gated by the role_permissions matrix.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const { data: profile } = await db.from('users')
    .select('id, role').eq('email', user.email).maybeSingle()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_ISSUE_TO_ACONEX, (profile?.role ?? 'reviewer') as any)) {
    return NextResponse.json({ error: 'You do not have permission to issue to Aconex' }, { status: 403 })
  }

  const { ids, aconexRef, cddlUpdated, notes } = await req.json()
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'Select at least one document' }, { status: 400 })
  if (!aconexRef?.trim()) return NextResponse.json({ error: 'The Aconex transmittal/document reference is required' }, { status: 400 })

  const nowIso = new Date().toISOString()
  const { data: updated, error } = await db.from('aconex_issue')
    .update({
      status: 'issued', aconex_document_ref: String(aconexRef).trim(),
      cddl_updated: !!cddlUpdated, notes: notes || null,
      issued_by: profile?.id ?? null, issued_by_email: user.email, issued_at: nowIso,
    })
    .in('id', ids).eq('status', 'pending')
    .select('id, batch_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  for (const bid of [...new Set((updated ?? []).map(u => u.batch_id).filter(Boolean))]) {
    await db.from('audit_events').insert({
      entity_type: 'batch', entity_id: bid, event_type: 'issued_to_aconex',
      actor_email: user.email,
      event_data: { aconexRef, cddlUpdated: !!cddlUpdated, count: (updated ?? []).filter(u => u.batch_id === bid).length },
    })
  }
  return NextResponse.json({ success: true, issued: updated?.length ?? 0 })
}
