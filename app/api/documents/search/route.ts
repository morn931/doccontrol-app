import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q           = searchParams.get('q') ?? ''
  const discipline  = searchParams.get('discipline') ?? ''
  const doc_type    = searchParams.get('doc_type') ?? ''
  const all_revisions = searchParams.get('all_revisions') === '1'

  const db = createServiceClient()

  let query = db
    .from('document_versions')
    .select(`
      id, file_name, revision, doc_name, discipline, document_type, topic,
      status, is_latest, uploaded_at, returned_at, central_file_url,
      doc_unique_id, document_id,
      batches(id, batch_guid, vendors(name, code), packages(package_code, package_name))
    `)

  if (!all_revisions) query = query.eq('is_latest', true)
  if (discipline)     query = query.ilike('discipline', `%${discipline}%`)
  if (doc_type)       query = query.ilike('document_type', `%${doc_type}%`)

  if (q) {
    // Split on commas/semicolons for multi-term search
    const terms = q.split(/[,;]+/).map(t => t.trim().replace(/'/g, "''")).filter(Boolean)
    const firstTerm = terms[0]
    if (firstTerm) {
      query = query.or(
        `file_name.ilike.%${firstTerm}%,doc_name.ilike.%${firstTerm}%,doc_unique_id.ilike.%${firstTerm}%,discipline.ilike.%${firstTerm}%,document_type.ilike.%${firstTerm}%,ai_text.ilike.%${firstTerm}%`
      )
    }
  }

  query = query.order('uploaded_at', { ascending: false }).limit(200)
  const { data: rawData, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Multi-term: filter in JS so every term matches at least one field
  let results = rawData ?? []
  if (q) {
    const terms = q.split(/[,;]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
    if (terms.length > 1) {
      results = results.filter((dv: any) => {
        const haystack = [
          dv.file_name, dv.doc_name, dv.doc_unique_id,
          dv.discipline, dv.document_type, dv.topic, dv.ai_text
        ].join(' ').toLowerCase()
        return terms.every(term => haystack.includes(term))
      })
    }
  }

  return NextResponse.json({ results, total: results.length })
}
