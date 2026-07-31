import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'

// Step 2 of stamping: after both uploads complete, record the register line —
// who stamped what, when, with which outcome, and where both copies live.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('role').eq('email', user.email).maybeSingle()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_REV0_STAMP, (profile?.role ?? 'reviewer') as any)) {
    return NextResponse.json({ error: 'You do not have permission to stamp Rev 0 documents' }, { status: 403 })
  }

  const { packageId, documentNumber, revision, outcome, stampDate, fileName, vendorFileUrl, bucketFileUrl } = await req.json()
  if (!documentNumber || !fileName) return NextResponse.json({ error: 'documentNumber and fileName required' }, { status: 400 })

  const { data: row, error } = await db.from('rev0_intake').insert({
    package_id: packageId ?? null,
    document_number: documentNumber, revision: revision ?? null,
    outcome: outcome ?? null, stamp_date: stampDate ?? new Date().toISOString().slice(0, 10),
    file_name: fileName, vendor_file_url: vendorFileUrl ?? null, bucket_file_url: bucketFileUrl ?? null,
    stamped_by_email: user.email,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await db.from('audit_events').insert({
    entity_type: 'rev0_intake', entity_id: row.id, event_type: 'rev0_stamped',
    actor_email: user.email,
    event_data: { documentNumber, revision, outcome, fileName },
  })
  return NextResponse.json({ success: true, id: row.id })
}
