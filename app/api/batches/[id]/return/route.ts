import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { returnBatchFilesToVendor } from '@/lib/services/return-to-vendor'
import { logActivity } from '@/lib/activity'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * POST /api/batches/[id]/return
 *
 * Re-run the in-app return-to-vendor copy for a batch WITHOUT regenerating the transmittal
 * (no new transmittal number). Two uses:
 *   1. Retry a return that failed or only partially copied.
 *   2. Remediate "new-app" batches whose files were never delivered because the old Power
 *      Automate flow silently skipped them (returned_to_vendor_at / returned_at null).
 * Idempotent: copyFileToVendorReturn overwrites in place, so re-running is safe.
 * Gated to the Document Controller (same permission as issuing a transmittal).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_GENERATE_TRANSMITTAL, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Only the Document Controller can return documents to a vendor.' }, { status: 403 })

  const { id: batchId } = await params
  const db = createServiceClient()

  const { data: batch } = await db.from('batches')
    .select('id, package_id, source_site_url, controller_email').eq('id', batchId).single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const result = await returnBatchFilesToVendor(db, batch)
  const nowIso = new Date().toISOString()
  if (result.ok) {
    await db.from('batches')
      .update({ status: 'returned_to_vendor', returned_at: nowIso, updated_at: nowIso }).eq('id', batchId)
    await db.from('transmittals')
      .update({ returned_to_vendor_at: nowIso }).eq('batch_id', batchId).is('returned_to_vendor_at', null)
  }

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batchId, event_type: 'return_to_vendor',
    actor_email: user.email,
    event_data: { ok: result.ok, copied: result.copied, total: result.total,
                  failed: result.failed, returnLibrary: result.returnLibrary, errors: result.errors.slice(0, 10) },
  })
  await logActivity({ area: 'transmittals', action: 'transmittal.return', targetType: 'batch', targetId: batchId,
    summary: `Returned ${result.copied}/${result.total} document(s) to vendor`, email: user.email! })

  // 207 Multi-Status when some (but not all) documents copied — the UI can flag a partial return.
  return NextResponse.json(result, { status: result.ok ? 200 : (result.copied > 0 ? 207 : 502) })
}
