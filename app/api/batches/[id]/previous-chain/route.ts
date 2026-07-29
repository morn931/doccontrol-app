import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'

// The "memory" behind revision carry-over (ruled 2026-07-28): when a new
// revision of a document arrives, derive the FULL reviewer chain of the
// previous revision live from review_tasks (no side register to maintain —
// the review history IS the memory), flagging reviewers who were added
// mid-review last time (they're the ones that get forgotten). The Assign
// Reviewers screen prefills the sequence from this.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: batchId } = await params
  const db = createServiceClient()

  const { data: docs } = await db.from('document_versions')
    .select('id, file_name').eq('batch_id', batchId)
  if (!docs?.length) return NextResponse.json({ chain: [] })

  type Entry = { email: string; name: string; addedMidReview: boolean; fromRevision: string | null; docNumbers: string[] }
  const chain: Entry[] = []
  const byEmail = new Map<string, Entry>()

  for (const doc of docs) {
    const parsed = parseDocumentFileName(doc.file_name ?? '')
    if (!parsed.displayDocumentNumber) continue

    // Candidate earlier versions of the same document number (any batch but this one).
    const { data: candidates } = await db.from('document_versions')
      .select('id, file_name, batch_id, uploaded_at')
      .ilike('file_name', `${parsed.displayDocumentNumber}%`)
      .neq('batch_id', batchId)
      .limit(50)

    const prior = (candidates ?? [])
      .map(c => ({ ...c, p: parseDocumentFileName(c.file_name ?? '') }))
      .filter(c => c.p.normalizedDocumentNumber === parsed.normalizedDocumentNumber)
      .filter(c => !parsed.revisionSort || !c.p.revisionSort || c.p.revisionSort < parsed.revisionSort)
      .sort((a, b) => (b.p.revisionSort ?? '').localeCompare(a.p.revisionSort ?? ''))
    const prev = prior[0]
    if (!prev) continue

    const { data: prevTasks } = await db.from('review_tasks')
      .select('reviewer_email, sequence_number')
      .eq('document_version_id', prev.id)
      .order('sequence_number', { ascending: true })
    if (!prevTasks?.length) continue

    // Who was added mid-review on the previous batch?
    const { data: added } = await db.from('audit_events')
      .select('event_data')
      .eq('entity_type', 'batch').eq('entity_id', prev.batch_id)
      .eq('event_type', 'reviewer_added')
    const addedEmails = new Set((added ?? [])
      .map((a: any) => String(a.event_data?.reviewerEmail ?? '').toLowerCase())
      .filter(Boolean))

    const seen = new Set<string>()
    for (const t of prevTasks) {
      const email = (t.reviewer_email ?? '').toLowerCase()
      if (!email || seen.has(email)) continue
      seen.add(email)
      let e = byEmail.get(email)
      if (!e) {
        e = { email: t.reviewer_email, name: t.reviewer_email, addedMidReview: false,
              fromRevision: prev.p.revision ?? null, docNumbers: [] }
        byEmail.set(email, e)
        chain.push(e)
      }
      if (addedEmails.has(email)) e.addedMidReview = true
      if (!e.docNumbers.includes(parsed.displayDocumentNumber)) e.docNumbers.push(parsed.displayDocumentNumber)
    }
  }

  // Resolve display names in one shot.
  if (chain.length) {
    const { data: users } = await db.from('users')
      .select('email, full_name')
      .in('email', chain.map(c => c.email))
    const nameByEmail = new Map((users ?? []).map((u: any) => [(u.email ?? '').toLowerCase(), u.full_name]))
    for (const c of chain) c.name = nameByEmail.get(c.email.toLowerCase()) || c.email
  }

  return NextResponse.json({ chain })
}
