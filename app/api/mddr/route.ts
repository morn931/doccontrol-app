import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const PAGE = 1000   // PostgREST caps a single response at 1000 rows — page past it.

// Explicit column list — NEVER select the heavy columns (embedding vector(1536),
// raw JSONB, ai_text); `select *` dragged them and timed the query out.
const COLS = [
  'id', 'source_type', 'source_types', 'package_code', 'contract_number', 'project_number',
  'package_description', 'sub_package', 'equipment_description', 'deliverable_name',
  'service_provider_pkg_no', 'vendor_name', 'doc_owner', 'sub_supplier',
  'document_number', 'normalized_document_number', 'ppe_doc_number', 'vendor_doc_id',
  'document_title', 'document_description', 'sheet_number', 'discipline', 'document_type',
  'document_category', 'area', 'system', 'sub_system', 'tag_number', 'revision', 'revision_status',
  'review_outcome_code', 'document_status', 'planned_start_date', 'planned_ifr_date',
  'planned_ifc_date', 'planned_completion_date', 'actual_submission_date', 'actual_review_date',
  'actual_return_date', 'actual_completion_date', 'activity_id', 'wbs_code',
  'weighting_primary', 'weighting_secondary', 'weighting_total', 'progress_percent',
  'progress_milestone', 'progress_source', 'earned_value', 'issued_for', 'as_built_required',
  'certified_final_required', 'schedule_status', 'aconex_doc_status', 'aconex_review_status',
  'comments', 'remarks', 'vendor_comments', 'is_awarded', 'is_active', 'sector', 'file_link',
].join(',')

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
  const revision     = url.searchParams.get('revision')      ?? ''
  const sector       = url.searchParams.get('sector')        ?? ''
  const excludeIndex = url.searchParams.get('exclude_index') === '1'   // register MDDR page
  const hasFile      = url.searchParams.get('has_file') === '1'        // only docs with an actual file
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '2000'), 20000)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  // Build a fresh query each page (supabase query builders are single-use).
  // No exact count — counting the filtered set over the large table hit the DB
  // statement timeout. The page loads the whole set (up to `limit`), so the
  // returned row count is the effective total.
  const build = (from: number, to: number) => {
    let query = db
      .from('mddr_entries')
      .select(COLS)
      .eq('is_active', true)
      .order('activity_id', { ascending: true, nullsFirst: false })
      .order('document_number', { ascending: true })
      .range(from, to)
    if (pkg)    query = query.eq('package_code', pkg)
    if (vendor) query = query.eq('vendor_name',  vendor)
    if (source) query = query.eq('source_type',  source)
    if (awarded === 'true')  query = query.eq('is_awarded', true)
    if (awarded === 'false') query = query.eq('is_awarded', false)
    if (discipline) {
      // may be a comma-separated list of raw values that share one display name
      const vals = discipline.split(',').map(v => v.trim()).filter(Boolean)
      query = vals.length > 1 ? query.in('discipline', vals) : query.eq('discipline', vals[0])
    }
    if (documentType) query = query.eq('document_type', documentType)
    if (status)       query = query.eq('document_status', status)
    if (revision)     query = query.eq('revision', revision)
    if (sector)       query = query.eq('sector', sector)
    if (excludeIndex) query = query.neq('source_type', 'INDEX')
    if (hasFile)      query = query.not('file_link', 'is', null)
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
  for (let from = offset; rows.length < limit; from += PAGE) {
    const to = Math.min(from + PAGE, offset + limit) - 1
    const { data, error } = await build(from, to)
    if (error) {
      console.error('[MDDR GET]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break   // last page
  }

  // rows.length is exact when the set fits under `limit`; '+' when capped.
  return NextResponse.json({ rows, total: rows.length, capped: rows.length >= limit })
}
