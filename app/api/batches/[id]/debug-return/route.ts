/**
 * GET /api/batches/[id]/debug-return
 *
 * Diagnostic endpoint — shows what batch_guid is stored in Supabase for this batch,
 * and whether a matching Approver Picks item exists in SharePoint.
 * Remove this route once the return-to-vendor trigger is confirmed working.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getSiteId, graphFetch } from '@/lib/services/graph'

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

  // 2. What does SharePoint have?
  const siteId = await getSiteId(DOCCONTROL_SITE)
  const scanRes = await graphFetch(
    `/sites/${siteId}/lists/${APPROVER_PICKS_ID}/items?$expand=fields($select=BatchID,ReturnRequested,ReturnComplete,SourceSiteURL)&$orderby=id desc&$top=200`
  )

  let spItems: any[] = []
  let spError: string | null = null
  if (scanRes.ok) {
    const data = await scanRes.json()
    spItems = data.value ?? []
  } else {
    spError = `${scanRes.status}: ${(await scanRes.text()).slice(0, 200)}`
  }

  // Find matching item
  const batchGuid = batch.batch_guid?.trim().toLowerCase()
  const matchedItem = spItems.find(
    (i: any) => i.fields?.BatchID?.trim().toLowerCase() === batchGuid
  )

  // Show recent items for comparison
  const recentItems = spItems.slice(0, 10).map((i: any) => ({
    spItemId: i.id,
    batchId: i.fields?.BatchID,
    returnRequested: i.fields?.ReturnRequested,
    returnComplete: i.fields?.ReturnComplete,
    sourceSiteURL: i.fields?.SourceSiteURL,
    matches: i.fields?.BatchID?.trim().toLowerCase() === batchGuid,
  }))

  return NextResponse.json({
    supabase: {
      batchId: batch.id,
      batch_guid: batch.batch_guid,
      source_site_url: batch.source_site_url,
      package_code: (batch.packages as any)?.package_code,
    },
    sharePoint: {
      error: spError,
      totalScanned: spItems.length,
      matchFound: !!matchedItem,
      matchedItem: matchedItem ? {
        spItemId: matchedItem.id,
        batchId: matchedItem.fields?.BatchID,
        returnRequested: matchedItem.fields?.ReturnRequested,
        returnComplete: matchedItem.fields?.ReturnComplete,
        sourceSiteURL: matchedItem.fields?.SourceSiteURL,
      } : null,
      recentItems,
    },
  })
}
