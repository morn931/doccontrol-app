import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const PAGE = 1000   // PostgREST caps a single response at 1000 rows — page past it.

export async function GET(req: NextRequest) {
  const db     = createServiceClient()
  const url    = new URL(req.url)
  const pkg    = url.searchParams.get('package')   ?? ''
  const vendor = url.searchParams.get('vendor')    ?? ''
  const source = url.searchParams.get('source')    ?? ''
  const awarded = url.searchParams.get('awarded')  ?? 'true'   // true | false | all
  const q      = url.searchParams.get('q')         ?? ''
  const docnum = url.searchParams.get('docnum')    ?? ''       // search Doc Number only
  const title  = url.searchParams.get('title')     ?? ''       // search Title only
  const discipline   = url.searchParams.get('discipline')    ?? ''
  const documentType = url.searchParams.get('document_type') ?? ''
  const status       = url.searchParams.get('status')        ?? ''
  const sector       = url.searchParams.get('sector')        ?? ''
  const excludeIndex = url.searchParams.get('exclude_index') === '1'   // register MDDR page
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '2000'), 20000)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  // Build a fresh query each page (supabase query builders are single-use).
  // Exact count only on the first page — counting on every page is what made the
  // large register query time out (returning a non-JSON error to the client).
  const build = (from: number, to: number, withCount: boolean) => {
    let query = db
      .from('mddr_entries')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .eq('is_active', true)
      .order('activity_id', { ascending: true, nullsFirst: false })
      .order('document_number', { ascending: true })
      .range(from, to)
    if (pkg)    query = query.eq('package_code', pkg)
    if (vendor) query = query.eq('vendor_name',  vendor)
    if (source) query = query.eq('source_type',  source)
    if (awarded === 'true')  query = query.eq('is_awarded', true)
    if (awarded === 'false') query = query.eq('is_awarded', false)
    if (discipline)   query = query.eq('discipline', discipline)
    if (documentType) query = query.eq('document_type', documentType)
    if (status)       query = query.eq('document_status', status)
    if (sector)       query = query.eq('sector', sector)
    if (excludeIndex) query = query.neq('source_type', 'INDEX')
    if (docnum) {
      const t = `%${docnum}%`
      query = query.or(`document_number.ilike.${t},normalized_document_number.ilike.${t},ppe_doc_number.ilike.${t},vendor_doc_id.ilike.${t}`)
    }
    if (title) {
      const t = `%${title}%`
      query = query.or(`document_title.ilike.${t},document_description.ilike.${t}`)
    }
    if (q) {
      const term = `%${q}%`
      query = query.or(
        `document_number.ilike.${term},normalized_document_number.ilike.${term},` +
        `document_title.ilike.${term},document_description.ilike.${term},` +
        `tag_number.ilike.${term},activity_id.ilike.${term},` +
        `discipline.ilike.${term},document_type.ilike.${term}`
      )
    }
    return query
  }

  const rows: any[] = []
  let total = 0
  for (let from = offset; rows.length < limit; from += PAGE) {
    const to = Math.min(from + PAGE, offset + limit) - 1
    const { data, error, count } = await build(from, to, from === offset)
    if (error) {
      console.error('[MDDR GET]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (count != null) total = count
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break   // last page
  }

  return NextResponse.json({ rows, total })
}
