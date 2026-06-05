/**
 * SharePoint List Service — Document Approval List (Agent) write-back
 *
 * Keeps the old DocControlAPP in sync so both systems show the same review state.
 * ALL writes set TriggerNext = false so va-sequential_next never fires.
 * The new app owns all email routing.
 *
 * List IDs (DocumentControl site):
 *   Document Approval List (Agent): 9711d630-daee-426e-b621-d941fc18c01f
 *   Approver Picks (Agent):         b5978f12-495c-49b6-bff4-3392a8d2a681
 */

import { getSiteId, graphFetch } from './graph'

const DOCCONTROL_SITE   = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!
const APPROVAL_LIST_ID  = '9711d630-daee-426e-b621-d941fc18c01f'
const PICKS_LIST_ID     = 'b5978f12-495c-49b6-bff4-3392a8d2a681'

let _siteId: string | null = null
async function getDocControlSiteId(): Promise<string> {
  if (_siteId) return _siteId
  _siteId = await getSiteId(DOCCONTROL_SITE)
  return _siteId
}

// ─── CREATE: Document Approval List row ─────────────────────────────────────
export interface ApprovalListRowData {
  title:          string   // document file name
  approverEmail:  string
  sequenceNumber: number
  batchId:        string   // batch GUID
  docUniqueId:    string   // e.g. K108-BATTERYENERGYSTORAGESYSTEM-123
  docUrl:         string   // DocumentControl URL (the bucket file)
  dueDate?:       string | null
  vendorSite?:    string | null
  libraryName?:   string | null
  docName?:       string | null
  discipline?:    string | null
  documentType?:  string | null
  topic?:         string | null
  aiText?:        string | null
}

export async function createApprovalListRow(data: ApprovalListRowData): Promise<number | null> {
  try {
    const siteId = await getDocControlSiteId()
    const body = {
      fields: {
        Title:            data.title,
        ApproverEmail:    data.approverEmail,
        SequenceNumber:   data.sequenceNumber,
        BatchID:          data.batchId,
        DocUniqueId:      data.docUniqueId,
        DocUrl:           data.docUrl,
        ReviewComplete:   false,
        TriggerNext:      false,   // CRITICAL — prevents va-sequential_next from firing
        SentToNextReviewer: false,
        ApprovalStatus:   'Pending',
        ...(data.dueDate     && { DueDate:      data.dueDate }),
        ...(data.vendorSite  && { VendorSite:   data.vendorSite }),
        ...(data.libraryName && { LibraryName:  data.libraryName }),
        ...(data.docName     && { DocName:      data.docName }),
        ...(data.discipline  && { Discipline:   data.discipline }),
        ...(data.documentType && { DocumentType: data.documentType }),
        ...(data.topic       && { Topic:        data.topic }),
        ...(data.aiText      && { AIText:        data.aiText.slice(0, 2000) }), // truncate for SP column limit
      }
    }
    const res = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items`,
      { method: 'POST', body: JSON.stringify(body) }
    )
    if (!res.ok) {
      console.error('DAL createRow failed:', await res.text())
      return null
    }
    const created = await res.json()
    return created.id ?? null
  } catch (e: any) {
    console.error('DAL createRow error:', e.message)
    return null
  }
}

// ─── FIND: Get SharePoint item ID for a review row ───────────────────────────
export async function findApprovalListItemId(
  docUniqueId: string,
  approverEmail: string,
  sequenceNumber: number
): Promise<string | null> {
  try {
    const siteId = await getDocControlSiteId()
    const filter = `fields/DocUniqueId eq '${docUniqueId}' and fields/ApproverEmail eq '${approverEmail}' and fields/SequenceNumber eq ${sequenceNumber}`
    const res = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items?$expand=fields($select=id,DocUniqueId,ApproverEmail,SequenceNumber)&$filter=${encodeURIComponent(filter)}&$top=1`
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.value?.[0]?.id ?? null
  } catch {
    return null
  }
}

// ─── UPDATE: Mark review complete ────────────────────────────────────────────
export interface ReviewCompletionData {
  reviewOutcomeCode:   string
  reviewOutcomeText?:  string
  comment?:            string
  dateCompleted:       string
  isManagerOverride?:  boolean
  markupSummary?:      string
}

export async function markApprovalListRowComplete(
  docUniqueId:    string,
  approverEmail:  string,
  sequenceNumber: number,
  data:           ReviewCompletionData
): Promise<boolean> {
  try {
    const siteId = await getDocControlSiteId()
    const itemId = await findApprovalListItemId(docUniqueId, approverEmail, sequenceNumber)
    if (!itemId) {
      console.warn(`DAL row not found: ${docUniqueId} / ${approverEmail} / ${sequenceNumber}`)
      return false
    }

    const fields: Record<string, any> = {
      ReviewComplete:        true,
      ReviewOutcomeCode:     data.reviewOutcomeCode,
      ReviewOutcomeText:     data.reviewOutcomeText ?? data.reviewOutcomeCode,
      Comment:               data.comment ?? '',
      DateCompleted:         data.dateCompleted,
      ReviewerDateCompleted: data.dateCompleted,
      TriggerNext:           false,   // CRITICAL — new app owns routing
      TriggerNextStamp:      '',      // clear any existing stamp
      ApprovalStatus:        'Completed',
      ...(data.isManagerOverride && { ManagerOverride: true }),
      ...(data.markupSummary     && { MarkupSummary: data.markupSummary }),
    }

    const res = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items/${itemId}/fields`,
      { method: 'PATCH', body: JSON.stringify(fields) }
    )
    if (!res.ok) {
      console.error('DAL updateRow failed:', await res.text())
      return false
    }
    return true
  } catch (e: any) {
    console.error('DAL markComplete error:', e.message)
    return false
  }
}

// ─── UPDATE: Mark reviewer email sent ────────────────────────────────────────
export async function markApprovalListRowSent(
  docUniqueId:    string,
  approverEmail:  string,
  sequenceNumber: number,
  dateSent:       string
): Promise<boolean> {
  try {
    const siteId = await getDocControlSiteId()
    const itemId = await findApprovalListItemId(docUniqueId, approverEmail, sequenceNumber)
    if (!itemId) return false

    const res = await graphFetch(
      `/sites/${siteId}/lists/${APPROVAL_LIST_ID}/items/${itemId}/fields`,
      { method: 'PATCH', body: JSON.stringify({
        DateSent:           dateSent,
        ReviewerDateSent:   dateSent,
        ApprovalStatus:     'Pending',
      })}
    )
    return res.ok
  } catch {
    return false
  }
}

// ─── UPDATE: Approver Picks row — set reviewers after assignment in new app ──
export async function updateApproverPicksReviewers(
  spItemId:       string | null,
  batchGuid:      string,
  reviewerEmails: string[],
  dueDate?:       string | null
): Promise<boolean> {
  try {
    const siteId = await getDocControlSiteId()
    let itemId = spItemId

    if (!itemId) {
      // Graph API $filter on custom SP columns is unreliable — scan recent items instead
      const scanRes = await graphFetch(
        `/sites/${siteId}/lists/${PICKS_LIST_ID}/items?$expand=fields($select=BatchID)&$orderby=id desc&$top=100`
      )
      if (!scanRes.ok) { console.error('Approver Picks scan failed:', await scanRes.text()); return false }
      const scanData = await scanRes.json()
      const found = scanData.value?.find((i: any) => i.fields?.BatchID === batchGuid)
      if (!found) { console.warn(`Approver Picks row not found for BatchID: ${batchGuid}`); return false }
      itemId = found.id
    }

    const patchRes = await graphFetch(
      `/sites/${siteId}/lists/${PICKS_LIST_ID}/items/${itemId}/fields`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ApproverEmail: reviewerEmails.join('; '),
          ReadyToStart:  true,
          ...(dueDate && { DueDate: dueDate }),
        })
      }
    )
    if (!patchRes.ok) { console.error('Approver Picks PATCH failed:', await patchRes.text()); return false }
    return true
  } catch (e: any) {
    console.error('updateApproverPicksReviewers error:', e.message)
    return false
  }
}
