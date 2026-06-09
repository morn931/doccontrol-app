import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const db     = createServiceClient()
  const url    = new URL(req.url)
  const pkg    = url.searchParams.get('package')   ?? ''
  const vendor = url.searchParams.get('vendor')    ?? ''
  const source = url.searchParams.get('source')    ?? ''
  const awarded = url.searchParams.get('awarded')  ?? 'true'   // true | false | all
  const q      = url.searchParams.get('q')         ?? ''
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '2000'), 5000)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  let query = db
    .from('mddr_entries')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
    .order('activity_id', { ascending: true, nullsFirst: false })
    .order('document_number', { ascending: true })
    .range(offset, offset + limit - 1)

  if (pkg)    query = query.eq('package_code', pkg)
  if (vendor) query = query.eq('vendor_name',  vendor)
  if (source) query = query.eq('source_type',  source)
  if (awarded === 'true')  query = query.eq('is_awarded', true)
  if (awarded === 'false') query = query.eq('is_awarded', false)
  if (q) {
    const term = `%${q}%`
    query = query.or(
      `document_number.ilike.${term},normalized_document_number.ilike.${term},` +
      `document_title.ilike.${term},document_description.ilike.${term},` +
      `tag_number.ilike.${term},activity_id.ilike.${term},` +
      `discipline.ilike.${term},document_type.ilike.${term}`
    )
  }

  const { data, error, count } = await query

  if (error) {
    console.error('[MDDR GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rows: data ?? [], total: count ?? 0 })
}
