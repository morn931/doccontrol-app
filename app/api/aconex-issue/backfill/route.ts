import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'

// One-click catch-up: internal/As-Built batches that completed review BEFORE
// the queue existed (or slipped past it) get their documents queued. Idempotent.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('role').eq('email', user.email).maybeSingle()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_ISSUE_TO_ACONEX, (profile?.role ?? 'reviewer') as any)) {
    return NextResponse.json({ error: 'You do not have permission to issue to Aconex' }, { status: 403 })
  }

  const { data: batches } = await db.from('batches')
    .select('id, source')
    .in('source', ['internal', 'asbuilt'])
    .in('status', ['review_complete', 'transmittal_generated'])
    .limit(1000)
  if (!batches?.length) return NextResponse.json({ added: 0, batches: 0 })

  const { data: existing } = await db.from('aconex_issue')
    .select('batch_id').in('batch_id', batches.map(b => b.id))
  const have = new Set((existing ?? []).map(e => e.batch_id))
  const todo = batches.filter(b => !have.has(b.id))

  let added = 0
  for (const b of todo) {
    const { data: docs } = await db.from('document_versions')
      .select('id, file_name, revision').eq('batch_id', b.id)
    const rows = (docs ?? []).map((d: any) => {
      const p = parseDocumentFileName(d.file_name ?? '')
      return {
        batch_id: b.id, document_version_id: d.id, source: b.source,
        rdmc_document_number: p.displayDocumentNumber || d.file_name,
        revision: d.revision ?? p.revision, status: 'pending',
      }
    })
    if (rows.length) {
      const { error } = await db.from('aconex_issue').insert(rows)
      if (!error) added += rows.length
    }
  }
  return NextResponse.json({ added, batches: todo.length })
}
