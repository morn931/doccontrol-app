import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'

// The "memory" behind revision carry-over (ruled 2026-07-28): when a new
// revision of a document arrives, derive the FULL reviewer chain of the
// previous revision live from review_tasks (no side register to maintain —
// the review history IS the memory), flagging reviewers who were added
// mid-review last time. The Assign Reviewers screen prefills from this.
//
// Redline batches (2026-07-29): the stored filename carries an upload suffix
// the parser can't read, so their document numbers come from the captured
// redline_document rows instead — and the MDDR document OWNER is returned as
// a suggested first reviewer when resolvable against the user directory.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: batchId } = await params
  const db = createServiceClient()

  const { data: batch } = await db.from('batches').select('id, source').eq('id', batchId).maybeSingle()
  if (!batch) return NextResponse.json({ chain: [] })

  // The document numbers this batch is about.
  let numbers: { display: string; normalized: string; revisionSort: string | null }[] = []
  if (batch.source === 'redline') {
    const { data: sub } = await db.from('redline_submission').select('id').eq('batch_id', batchId).maybeSingle()
    if (sub) {
      const { data: rdocs } = await db.from('redline_document')
        .select('drawing_number').eq('submission_id', sub.id)
      numbers = (rdocs ?? []).map(r => {
        const n = String(r.drawing_number).trim().toUpperCase().replace(/\s+/g, '')
        return { display: n, normalized: n, revisionSort: null }
      })
    }
  } else {
    const { data: docs } = await db.from('document_versions')
      .select('id, file_name').eq('batch_id', batchId)
    numbers = (docs ?? []).map(d => {
      const p = parseDocumentFileName(d.file_name ?? '')
      return { display: p.displayDocumentNumber, normalized: p.normalizedDocumentNumber, revisionSort: p.revisionSort }
    }).filter(n => !!n.display)
  }
  if (!numbers.length) return NextResponse.json({ chain: [] })

  type Entry = { email: string; name: string; addedMidReview: boolean; fromRevision: string | null; docNumbers: string[] }
  const chain: Entry[] = []
  const byEmail = new Map<string, Entry>()

  for (const num of numbers) {
    // Candidate earlier versions of the same document number (any batch but this one).
    const { data: candidates } = await db.from('document_versions')
      .select('id, file_name, batch_id, uploaded_at')
      .ilike('file_name', `${num.display}%`)
      .neq('batch_id', batchId)
      .limit(50)

    const prior = (candidates ?? [])
      .map(c => ({ ...c, p: parseDocumentFileName(c.file_name ?? '') }))
      .filter(c => c.p.normalizedDocumentNumber === num.normalized)
      .filter(c => !num.revisionSort || !c.p.revisionSort || c.p.revisionSort < num.revisionSort)
      .sort((a, b) => (b.p.revisionSort ?? '').localeCompare(a.p.revisionSort ?? ''))
    const prev = prior[0]
    if (!prev) continue

    const { data: prevTasks } = await db.from('review_tasks')
      .select('reviewer_email, sequence_number')
      .eq('document_version_id', prev.id)
      .order('sequence_number', { ascending: true })
    if (!prevTasks?.length) continue

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
      if (!e.docNumbers.includes(num.display)) e.docNumbers.push(num.display)
    }
  }

  // Directory for name resolution (chain names + owner-initials matching).
  const { data: users } = await db.from('users').select('email, full_name').limit(500)
  const nameByEmail = new Map((users ?? []).map((u: any) => [(u.email ?? '').toLowerCase(), u.full_name]))
  for (const c of chain) c.name = nameByEmail.get(c.email.toLowerCase()) || c.email

  // Redline batches: suggest the MDDR document owner as first reviewer.
  let owner: { raw: string; email: string | null; name: string | null } | null = null
  if (batch.source === 'redline') {
    for (const num of numbers) {
      const { data: reg } = await db.from('mddr_entries')
        .select('doc_owner').eq('normalized_document_number', num.normalized)
        .not('doc_owner', 'is', null).limit(1).maybeSingle()
      const raw = (reg?.doc_owner ?? '').trim()
      if (!raw) continue
      // Resolve: full-name match first, else UNIQUE initials match (MC → Morne
      // Cronje). Ambiguous or unknown stays display-only — never a wrong guess.
      const lc = raw.toLowerCase()
      const initials = raw.replace(/[^A-Za-z]/g, '').toUpperCase()
      const matches = (users ?? []).filter((u: any) => {
        const fn = String(u.full_name ?? '').trim()
        if (!fn) return false
        if (fn.toLowerCase() === lc) return true
        const ini = fn.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('')
        return initials.length >= 2 && ini === initials
      })
      owner = {
        raw,
        email: matches.length === 1 ? matches[0].email : null,
        name: matches.length === 1 ? matches[0].full_name : null,
      }
      break
    }
  }

  return NextResponse.json({ chain, owner })
}
