/**
 * GET /api/debug/sp-approver?secret=<INTAKE_WEBHOOK_SECRET>
 *
 * Diagnostic endpoint — tests the exact UIL lookup + Approver PATCH logic
 * that createApprovalListRow uses. Returns full trace of what works/fails.
 * Protected by INTAKE_WEBHOOK_SECRET so it's not open to the public.
 * DELETE THIS FILE once Approver issue is resolved.
 */

import { NextResponse } from 'next/server'
import { getSiteId, graphFetch } from '@/lib/services/graph'

const APPROVAL_LIST_ID = '9711d630-daee-426e-b621-d941fc18c01f'
const SITE_URL = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!

// Known test item IDs (from our previous tests — Approver field exists, we can safely PATCH)
const TEST_ITEM_IDS = [4024, 4025]
const TEST_EMAILS   = ['mornec@ppetech.co.za', 'liezlc@ppetech.co.za']

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== process.env.INTAKE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const trace: Record<string, any> = {}

  try {
    // 1. Get site ID
    const siteId = await getSiteId(SITE_URL)
    trace.siteId = siteId

    // 2. Query User Information List
    const uilRes = await graphFetch(
      `/sites/${siteId}/lists/User%20Information%20List/items?$expand=fields($select=EMail,Title)&$top=999`
    )
    trace.uilStatus = uilRes.status
    trace.uilOk = uilRes.ok

    if (!uilRes.ok) {
      trace.uilError = (await uilRes.text()).slice(0, 500)
      return NextResponse.json({ trace })
    }

    const uilData = await uilRes.json()
    const allItems = uilData.value ?? []
    trace.uilTotalItems = allItems.length

    // Show first 5 items so we can see field structure
    trace.uilSample = allItems.slice(0, 5).map((i: any) => ({
      id: i.id,
      fieldsKeys: Object.keys(i.fields ?? {}),
      EMail: i.fields?.EMail,
      Email: i.fields?.Email,   // check both casings
      Title: i.fields?.Title,
    }))

    // Try to find test emails
    const lookupMap: Record<string, number | null> = {}
    for (const email of TEST_EMAILS) {
      // Try EMail (capital M)
      let match = allItems.find((i: any) => i.fields?.EMail?.toLowerCase() === email.toLowerCase())
      if (!match) {
        // Try Email (lowercase m)
        match = allItems.find((i: any) => i.fields?.Email?.toLowerCase() === email.toLowerCase())
      }
      lookupMap[email] = match ? Number(match.id) : null
      trace[`lookup_${email}`] = { found: !!match, itemId: match?.id, uilId: lookupMap[email] }
    }

    // 3. Try PATCH on each test item with its resolved lookup ID
    for (let i = 0; i < TEST_EMAILS.length; i++) {
      const email    = TEST_EMAILS[i]
      const spItemId = TEST_ITEM_IDS[i]
      const uilId    = lookupMap[email]
      const key      = `patch_item${spItemId}_${email}`

      if (uilId === null) {
        trace[key] = { skipped: true, reason: 'no lookup ID found' }
        continue
      }

      const patchRes = await graphFetch(
        `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items/${spItemId}/fields`,
        { method: 'PATCH', body: JSON.stringify({ ApproverLookupId: uilId }) }
      )
      const patchBody = await patchRes.text()
      trace[key] = {
        uilId,
        status: patchRes.status,
        ok: patchRes.ok,
        response: patchBody.slice(0, 300),
      }
    }

    // 4. Read back the test items to see final state
    for (let i = 0; i < TEST_ITEM_IDS.length; i++) {
      const spItemId = TEST_ITEM_IDS[i]
      const readRes = await graphFetch(
        `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items/${spItemId}/fields`
      )
      if (readRes.ok) {
        const f = await readRes.json()
        trace[`readback_item${spItemId}`] = {
          Approver: f.Approver,
          ApproverLookupId: f.ApproverLookupId,
          ApproverEmail: f.ApproverEmail,
        }
      }
    }

  } catch (e: any) {
    trace.fatalError = e.message
  }

  return NextResponse.json({ trace }, { status: 200 })
}
