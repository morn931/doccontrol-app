import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: batchId } = await params
  const { reviewerEmail, reviewerName, insertAfterSequence, reason } = await req.json()

  if (!reviewerEmail) return NextResponse.json({ error: 'Reviewer email required' }, { status: 400 })

  const db = createServiceClient()

  // Get all document_versions in the batch
  const { data: docVersions } = await db.from('document_versions')
    .select('id').eq('batch_id', batchId)

  if (!docVersions?.length) return NextResponse.json({ error: 'No documents in batch' }, { status: 400 })

  // Get existing tasks to determine sequence number
  const { data: existingTasks } = await db.from('review_tasks')
    .select('sequence_number').eq('batch_id', batchId)
    .order('sequence_number', { ascending: false }).limit(1)

  const maxSeq = existingTasks?.[0]?.sequence_number ?? 0
  const newSeq = insertAfterSequence ? insertAfterSequence + 1 : maxSeq + 1

  // If inserting in the middle, shift existing pending tasks up
  if (insertAfterSequence) {
    await db.from('review_tasks')
      .update({ sequence_number: db.rpc('sequence_number', {}) })
      .eq('batch_id', batchId)
      .gt('sequence_number', insertAfterSequence)
      .eq('status', 'pending')
    // Use raw update instead
    const { data: toShift } = await db.from('review_tasks')
      .select('id, sequence_number')
      .eq('batch_id', batchId)
      .gt('sequence_number', insertAfterSequence)
      .eq('status', 'pending')
    for (const t of (toShift ?? [])) {
      await db.from('review_tasks').update({ sequence_number: t.sequence_number + 1 }).eq('id', t.id)
    }
  }

  // Create new review_tasks for each document
  const newTasks = docVersions.map((dv: any) => ({
    batch_id:            batchId,
    document_version_id: dv.id,
    reviewer_email:      reviewerEmail,
    sequence_number:     newSeq,
    status:              'pending',
    created_at:          new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  }))

  const { error } = await db.from('review_tasks').insert(newTasks)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log escalation
  await db.from('review_escalations').insert({
    batch_id:    batchId,
    reason:      reason ?? `Additional reviewer added: ${reviewerEmail}`,
    status:      'open',
    created_at:  new Date().toISOString(),
  })

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batchId,
    event_type:  'reviewer_added',
    event_data:  { reviewerEmail, reviewerName, insertAfterSequence, newSeq },
  })

  return NextResponse.json({ success: true, sequenceNumber: newSeq })
}
