/**
 * GET /api/batches/[id]/debug-return
 *
 * Diagnostic endpoint — shows what batch_guid is stored in Supabase for this batch,
 * and whether a matching Approver Picks item exists in SharePoint.
 * Remove this route once the return-to-vendor trigger is confirmed working.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getSiteId, graphFetch, getGraphToken } from '@/lib/services/graph'

async function graphFetchAbsolute(url: string): Promise<Response> {
  const token = await getGraphToken()
  return fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
}

const DOCCONTROL_SITE   = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!
const APPROVER_PICKS_ID = 'b5978f12-495c-49b6-bff4-3392a8d2a681'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: batchId } = await params
  const db = createServiceClient()

  // 1. What does Supabase have?
  const { data: batch } = await db.from('batches')
    .select('id, batch_guid, source_site_url, package_id, packages(package_code)')
    .eq('id', batchId).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // 2. What does SharePoint have? Paginate until match found (max 30 pages).
  const siteId = await getSiteId(DOCCONTROL_SITE)
  const targetGuid = batch.batch_guid?.trim().toLowerCase()
  let matchedItem: any = null
  let spError: string | null = null
  let totalScanned = 0
  let nextUrl: string | null = null
  const firstUrl = `/sites/${siteId}/lists/${APPROVER_PICKS_ID}/items?$expand=fields($select=BatchID,ReturnRequested,ReturnComplete,SourceSiteURL)&$top=200`

  for (let page = 0; page < 30; page++) {
    const res = page === 0 ? await graphFetch(firstUrl) : await graphFetchAbsolute(nextUrl!)
    if (!res.ok) { spError = `${res.status}: ${(await res.text()).slice(0, 200)}`; break }
    const data = await res.json()
    const items: any[] = data.value ?? []
    totalScanned += items.length
    matchedItem = items.find((i: any) => i.fields?.BatchID?.trim().toLowerCase() === targetGuid)
    if (matchedItem) break
    nextUrl = data['@odata.nextLink'] ?? null
    if (!nextUrl) break
  }

  const recentItems: any[] = [] // not needed once pagination works

  return NextResponse.json({
    supabase: {
      batchId: batch.id,
      batch_guid: batch.batch_guid,
      source_site_url: batch.source_site_url,
      package_code: (batch.packages as any)?.package_code,
    },
    sharePoint: {
      error: spError,
      totalScanned,
      matchFound: !!matchedItem,
      matchedItem: matchedItem ? {
        spItemId: matchedItem.id,
        batchId: matchedItem.fields?.BatchID,
        returnRequested: matchedItem.fields?.ReturnRequested,
        returnComplete: matchedItem.fields?.ReturnComplete,
        sourceSiteURL: matchedItem.fields?.SourceSiteURL,
      } : null,
    },
  })
}
