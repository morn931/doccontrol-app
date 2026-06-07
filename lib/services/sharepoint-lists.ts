/**
 * SharePoint List Service — Document Approval List (Agent) write-back
 *
 * Keeps DocControlAPP in sync with reviews done in the new app.
 * One row per document per reviewer, matching the old system structure.
 * TriggerNext is always false — new app owns email routing.
 *
 * List ID (DocumentControl site):
 *   Document Approval List (Agent): 9711d630-daee-426e-b621-d941fc18c01f
 */

import { getSiteId, graphFetch } from './graph'

const DOCCONTROL_SITE  = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!
const APPROVAL_LIST_ID = '9711d630-daee-426e-b621-d941fc18c01f'

let _siteId: string | null = null
async function getDocControlSiteId(): Promise<string> {
  if (_siteId) return _siteId
  _siteId = await getSiteId(DOCCONTROL_SITE)
  return _siteId
}

/**
 * Resolve email → SharePoint User Information List item ID (integer).
 *
 * This integer is required when writing to a Person/Group field via Graph API
 * (field name: `ApproverLookupId`). Confirmed working via test script:
 *   - UIL is accessible through Graph API with Sites.ReadWrite.All
 *   - item.id (e.g. 9, 55) maps directly to ApproverLookupId
 *   - SharePoint REST API (siteusers, ensureuser) is 401 — app has Graph perms only
 *
 * Queries the UIL once and caches all users for the lifetime of the function instance.
 */
let _uilCache: Record<string, number> | null = null

async function resolveSpUserLookupId(siteId: string, email: string): Promise<number | null> {
  // Build cache on first call
  if (_uilCache === null) {
    _uilCache = {}
    try {
      const res = await graphFetch(
        `/sites/${siteId}/lists/User%20Information%20List/items?$expand=fields($select=EMail,Title)&$top=999`
      )
      if (!res.ok) {
        console.error('UIL query failed:', res.status, (await res.text()).slice(0, 200))
        _uilCache = null
        return null
      }
      const data = await res.json()
      for (const item of data.value ?? []) {
        if (item.fields?.EMail) {
          _uilCache[item.fields.EMail.toLowerCase()] = Number(item.id)
        }
      }
      console.log(`UIL cache built: ${Object.keys(_uilCache).length} users`)
    } catch (e: any) {
      console.error('UIL cache error:', e.message)
      _uilCache = null
      return null
    }
  }

  const id = _uilCache[email.toLowerCase()]
  if (!id) console.warn(`SP user not found in UIL: ${email} — Approver column will be empty`)
  return id ?? null
}

// ─── CREATE: one Document Approval List row per reviewer per document ─────────
export interface ApprovalListRowData {
  fileName:       string   // document file name → Title
  approverEmail:  string   // text email address
  sequenceNumber: number
  batchGuid:      string   // batch GUID → BatchID
  docUniqueId:    string   // e.g. K108-BATTERYENERGYSTORAGESYSTEM-33
  docUrl:         string   // DocumentControl bucket URL
  libraryName?:   string | null
  vendorSite?:    string | null
  dueDate?:       string | null
  docName?:       string | null
  discipline?:    string | null
  documentType?:  string | null
  topic?:         string | null
  aiText?:        string | null
}

export async function createApprovalListRow(data: ApprovalListRowData): Promise<{ ok: boolean; itemId?: string; error?: string }> {
  try {
    const siteId = await getDocControlSiteId()

    // Resolve the reviewer email to a SharePoint user lookup ID so the
    // Person/Group `Approver` column is populated (plain email won't work there).
    const approverLookupId = await resolveSpUserLookupId(siteId, data.approverEmail)

    const fields: Record<string, any> = {
      Title:           data.fileName,
      ApproverEmail:   data.approverEmail,   // plain-text backup field
      SequenceNumber:  data.sequenceNumber,
      BatchID:         data.batchGuid,
      DocUniqueId:     data.docUniqueId,
      DocUrl:          data.docUrl,
      ReviewComplete:  false,
      TriggerNext:     false,
    }

    // Optional fields — only set if we have values
    if (data.libraryName) fields.LibraryName  = data.libraryName.replace(/^\//, '') // strip leading slash
    if (data.vendorSite)  fields.VendorSite   = data.vendorSite
    if (data.dueDate)     fields.DueDate      = data.dueDate
    if (data.docName)     fields.DocName      = data.docName.slice(0, 255)
    if (data.discipline)  fields.Discipline   = data.discipline.slice(0, 255)
    if (data.documentType) fields.DocumentType = data.documentType.slice(0, 255)
    if (data.topic)       fields.Topic        = data.topic.slice(0, 255)
    if (data.aiText)      fields.AIText       = data.aiText.slice(0, 3000)

    // ── Step 1: Create the row ────────────────────────────────────────────────
    const createRes = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items`,
      { method: 'POST', body: JSON.stringify({ fields }) }
    )

    if (!createRes.ok) {
      const errText = await createRes.text()
      console.error('DAL createRow failed:', createRes.status, errText)
      return { ok: false, error: `${createRes.status}: ${errText.slice(0, 200)}` }
    }

    const created = await createRes.json()
    const newItemId = created.id

    // ── Step 2: PATCH the Person/Group Approver field ─────────────────────────
    // Graph API does not reliably set Person/Group fields in a POST body.
    // A separate PATCH immediately after creation is confirmed working
    // (ApproverLookupId=<UIL integer id>, HTTP 200 — verified in test script v2).
    if (approverLookupId !== null && newItemId) {
      const patchRes = await graphFetch(
        `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items/${newItemId}/fields`,
        { method: 'PATCH', body: JSON.stringify({ ApproverLookupId: approverLookupId }) }
      )
      if (!patchRes.ok) {
        const patchErr = await patchRes.text()
        console.warn(`DAL Approver PATCH failed for item ${newItemId}:`, patchRes.status, patchErr.slice(0, 200))
        // Non-fatal — row exists, only Approver display name is missing
      } else {
        console.log(`DAL Approver set: item=${newItemId} email=${data.approverEmail} lookupId=${approverLookupId}`)
      }
    } else {
      console.warn(`Approver not set for ${data.approverEmail}: lookupId=${approverLookupId} itemId=${newItemId}`)
    }

    return { ok: true, itemId: newItemId ? String(newItemId) : undefined }
  } catch (e: any) {
    console.error('DAL createRow error:', e.message)
    return { ok: false, error: e.message }
  }
}

// ─── UPDATE: mark review complete ────────────────────────────────────────────
export interface ReviewCompletionData {
  reviewOutcomeCode: string
  comment?:          string
  dateCompleted:     string
  markupSummary?:    string
}

export async function markApprovalListRowComplete(
  docUniqueId:    string,
  approverEmail:  string,
  sequenceNumber: number,
  data:           ReviewCompletionData,
  spItemId?:      string   // stored SP list item ID — avoids unreliable scan
): Promise<{ ok: boolean; error?: string }> {
  try {
    const siteId = await getDocControlSiteId()

    // Prefer direct item ID PATCH (fast, reliable).
    // Fall back to scan when item ID isn't stored (e.g. rows created before this change).
    let targetId: string | undefined = spItemId

    if (!targetId) {
      // Scan recent items and match by ApproverEmail + SequenceNumber.
      // Also try DocUniqueId when available; skip that check when it's empty.
      const scanRes = await graphFetch(
        `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items?$expand=fields($select=DocUniqueId,ApproverEmail,SequenceNumber,Title)&$orderby=id desc&$top=200`
      )
      if (!scanRes.ok) return { ok: false, error: await scanRes.text() }

      const scanData = await scanRes.json()
      const found = scanData.value?.find((i: any) => {
        const spDocId    = i.fields?.DocUniqueId ?? ''
        const emailMatch = i.fields?.ApproverEmail === approverEmail
        const seqMatch   = Number(i.fields?.SequenceNumber) === sequenceNumber
        const idMatch    = docUniqueId ? spDocId === docUniqueId : true
        return emailMatch && seqMatch && idMatch
      })

      if (!found) {
        console.warn(`DAL row not found (scan): ${docUniqueId} / ${approverEmail} / seq${sequenceNumber}`)
        return { ok: false, error: 'Row not found' }
      }
      targetId = String(found.id)
      console.log(`DAL row found via scan: item=${targetId}`)
    } else {
      console.log(`DAL row direct PATCH: item=${targetId}`)
    }

    const fields: Record<string, any> = {
      ReviewComplete:        true,
      ReviewOutcomeCode:     data.reviewOutcomeCode,
      ReviewOutcomeText:     data.reviewOutcomeCode,
      Comment:               data.comment ?? '',
      DateCompleted:         data.dateCompleted,
      ReviewerDateCompleted: data.dateCompleted,
      TriggerNext:           false,  // CRITICAL — new app handles routing
    }
    if (data.markupSummary) fields.MarkupSummary = data.markupSummary

    const patchRes = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items/${targetId}/fields`,
      { method: 'PATCH', body: JSON.stringify(fields) }
    )
    if (!patchRes.ok) {
      const errText = await patchRes.text()
      console.error('DAL updateRow failed:', patchRes.status, errText)
      return { ok: false, error: `${patchRes.status}: ${errText.slice(0, 200)}` }
    }
    console.log(`DAL markComplete OK: item=${targetId} outcome=${data.reviewOutcomeCode}`)
    return { ok: true }
  } catch (e: any) {
    console.error('DAL markComplete error:', e.message)
    return { ok: false, error: e.message }
  }
}

// ─── UPDATE: mark reviewer email sent ────────────────────────────────────────
export async function markApprovalListRowSent(
  docUniqueId:    string,
  approverEmail:  string,
  sequenceNumber: number,
  dateSent:       string
): Promise<void> {
  try {
    const siteId = await getDocControlSiteId()
    const scanRes = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items?$expand=fields($select=DocUniqueId,ApproverEmail,SequenceNumber)&$orderby=id desc&$top=200`
    )
    if (!scanRes.ok) return
    const scanData = await scanRes.json()
    const found = scanData.value?.find((i: any) =>
      i.fields?.DocUniqueId   === docUniqueId &&
      i.fields?.ApproverEmail === approverEmail &&
      Number(i.fields?.SequenceNumber) === sequenceNumber
    )
    if (!found) return

    await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items/${found.id}/fields`,
      { method: 'PATCH', body: JSON.stringify({ DateSent: dateSent, ReviewerDateSent: dateSent }) }
    )
  } catch (e: any) {
    console.error('DAL markSent error:', e.message)
  }
}
