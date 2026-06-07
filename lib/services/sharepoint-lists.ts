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

import { getSiteId, graphFetch, getSharePointToken } from './graph'

const DOCCONTROL_SITE  = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!
const APPROVAL_LIST_ID = '9711d630-daee-426e-b621-d941fc18c01f'

let _siteId: string | null = null
async function getDocControlSiteId(): Promise<string> {
  if (_siteId) return _siteId
  _siteId = await getSiteId(DOCCONTROL_SITE)
  return _siteId
}

/**
 * Resolve an email address to the SharePoint site user ID (integer).
 * Uses the SharePoint REST API /_api/web/siteusers endpoint with a
 * SharePoint-scoped token (different audience from the Graph token).
 * The integer Id is required when writing to a Person/Group field via
 * Graph API — set as `ApproverLookupId` in the fields payload.
 */
const _userIdCache: Record<string, number> = {}
async function resolveSpUserLookupId(email: string): Promise<number | null> {
  const key = email.toLowerCase()
  if (_userIdCache[key]) return _userIdCache[key]
  try {
    const token = await getSharePointToken()
    const siteBase = DOCCONTROL_SITE.replace(/\/$/, '')
    // Do NOT encodeURIComponent the email inside the OData filter string —
    // that would turn @ into %40 which SharePoint treats as a literal string.
    const url = `${siteBase}/_api/web/siteusers?$filter=Email eq '${email}'&$select=Id,Email`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json;odata=nometadata',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('siteusers query failed:', res.status, text.slice(0, 300))
      return null
    }
    const data = await res.json()
    const user = data.value?.[0]
    if (!user) {
      console.warn(`SP site user not found for ${email} — Approver column will be empty`)
      return null
    }
    _userIdCache[key] = user.Id
    return user.Id
  } catch (e: any) {
    console.error('resolveSpUserLookupId error:', e.message)
    return null
  }
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

export async function createApprovalListRow(data: ApprovalListRowData): Promise<{ ok: boolean; error?: string }> {
  try {
    const siteId = await getDocControlSiteId()

    // Resolve the reviewer email to a SharePoint user lookup ID so the
    // Person/Group `Approver` column is populated (plain email won't work there).
    const approverLookupId = await resolveSpUserLookupId(data.approverEmail)

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

    // Set the Person/Group field only if we resolved the user ID
    if (approverLookupId !== null) {
      fields.ApproverLookupId = approverLookupId
    } else {
      console.warn(`Could not resolve SP user for ${data.approverEmail} — Approver column will be empty`)
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

    const res = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items`,
      { method: 'POST', body: JSON.stringify({ fields }) }
    )

    if (!res.ok) {
      const errText = await res.text()
      console.error('DAL createRow failed:', res.status, errText)
      return { ok: false, error: `${res.status}: ${errText.slice(0, 200)}` }
    }

    return { ok: true }
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
  data:           ReviewCompletionData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const siteId = await getDocControlSiteId()

    // Find row by DocUniqueId + ApproverEmail + SequenceNumber
    // Scan recent items — Graph API $filter on custom SP columns is unreliable
    const scanRes = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items?$expand=fields($select=DocUniqueId,ApproverEmail,SequenceNumber)&$orderby=id desc&$top=200`
    )
    if (!scanRes.ok) return { ok: false, error: await scanRes.text() }

    const scanData = await scanRes.json()
    const found = scanData.value?.find((i: any) =>
      i.fields?.DocUniqueId   === docUniqueId &&
      i.fields?.ApproverEmail === approverEmail &&
      Number(i.fields?.SequenceNumber) === sequenceNumber
    )

    if (!found) {
      console.warn(`DAL row not found: ${docUniqueId} / ${approverEmail} / ${sequenceNumber}`)
      return { ok: false, error: 'Row not found' }
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
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items/${found.id}/fields`,
      { method: 'PATCH', body: JSON.stringify(fields) }
    )
    if (!patchRes.ok) {
      const errText = await patchRes.text()
      console.error('DAL updateRow failed:', errText)
      return { ok: false, error: errText.slice(0, 200) }
    }
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
