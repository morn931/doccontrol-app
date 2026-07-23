/**
 * Email template builder for document control notifications.
 * All templates return HTML strings for use with the Graph API sendEmail service.
 *
 * All CoreDocs notifications render through the ONE shared, Outlook-safe wrapper
 * (lib/services/coredocs-email-layout.ts) -- table-based structure, inline styles,
 * Calibri, navy header with the real Coreflow/PPE logos, uncropped slate hero, teal
 * rule. Do not reintroduce CSS classes for structural formatting here.
 */
import { renderCoreDocsEmail, metaTable, calloutBlock, dangerCalloutBlock, ctaButtonHtml } from './coredocs-email-layout'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://docs.coreflow.build'

function layout(title: string, bodyHtml: string): string {
  return renderCoreDocsEmail({ title, heading: title, bodyHtml })
}

export function newBatchEmail(params: {
  batchId:     string
  batchDbId:   string
  packageName: string
  vendorCode:  string
  vendorEmail: string
  fileNames:   string[]
  aiSummary:   string
  discipline:  string
  docType:     string
}): string {
  const batchUrl  = `${APP_URL}/batches/${params.batchDbId}`
  const fileList  = `<ul style="margin:0;padding-left:16px;">${params.fileNames.map(f => `<li style="margin:4px 0;word-break:break-all;">${f}</li>`).join('')}</ul>`

  return layout('New Document Batch Received', `
    <p style="margin:0 0 16px 0;">A new document batch has been received from <strong>${params.vendorCode}</strong> and is ready for your review.</p>
    ${metaTable([
      ['Package', params.packageName],
      ['Vendor', params.vendorCode],
      ['Files', fileList],
      ['Discipline', params.discipline || 'Pending'],
      ['Document Type', params.docType || 'Pending'],
    ])}
    ${params.aiSummary ? calloutBlock(`<strong>AI Summary:</strong><br>${params.aiSummary}`) : ''}
    <p style="margin:16px 0 0 0;">${ctaButtonHtml(batchUrl, 'Open Batch in Document Control')}</p>
    <p style="font-size:13px;color:#6B7280;margin:8px 0 0 0;">Please review the documents, confirm the AI classification, and assign reviewers to begin the formal review process.</p>
  `)
}

export function batchRejectedEmail(params: {
  packageName: string
  vendorCode:  string
  fileNames:   string[]
  rejectReason: string
  controllerEmail: string
}): string {
  const fileList = `<ul style="margin:0;padding-left:16px;">${params.fileNames.map(f => `<li style="margin:4px 0;word-break:break-all;">${f}</li>`).join('')}</ul>`

  return layout('Document Batch Rejected — Action Required', `
    <p style="margin:0 0 16px 0;">Your document batch submitted to <strong>${params.packageName}</strong> has been rejected by PPE Tech Document Control before formal review.</p>
    ${metaTable([
      ['Package', params.packageName],
      ['Files', fileList],
    ])}
    ${dangerCalloutBlock(`<strong>Rejection Reason:</strong><br>${params.rejectReason}`)}
    <p style="margin:16px 0;">Please delete the current versions from your SharePoint drop-off folder and upload corrected documents as a new batch.</p>
    <p style="font-size:13px;color:#6B7280;margin:0;">If you have questions, please contact the Document Controller at ${params.controllerEmail}</p>
  `)
}

export function reviewAssignedEmail(params: {
  reviewerName:   string
  reviewTaskId:   string
  packageName:    string
  fileName:       string
  docTitle:       string
  dueDate:        string | null
  sequencePos:    number
  totalReviewers: number
  instructions:   string
  isManagerOverride: boolean
}): string {
  const reviewUrl = `${APP_URL}/reviews/${params.reviewTaskId}`
  const rows: Array<[string, string]> = [
    ['Package', params.packageName],
    ['Document', `<strong>${params.docTitle}</strong>`],
    ['File Name', `<span style="font-family:monospace;word-break:break-all;">${params.fileName}</span>`],
    ['Reviewer Position', `${params.sequencePos} of ${params.totalReviewers}`],
  ]
  if (params.dueDate) {
    rows.push(['Due Date', `<strong style="color:#DC2626;">${new Date(params.dueDate).toLocaleDateString('en-ZA', { day:'numeric', month:'long', year:'numeric' })}</strong>`])
  }

  return layout(`Review Required: ${params.docTitle}`, `
    <p style="margin:0 0 16px 0;">Dear ${params.reviewerName},</p>
    <p style="margin:0 0 16px 0;">You have been assigned a document for ${params.isManagerOverride ? '<strong>engineering review (additional review requested)</strong>' : 'review'}. Please review and submit your outcome by the due date.</p>
    ${metaTable(rows)}
    ${params.instructions ? calloutBlock(`<strong>Instructions from Document Controller:</strong><br>${params.instructions}`) : ''}
    <p style="margin:16px 0 0 0;">${ctaButtonHtml(reviewUrl, 'Open Review Workspace')}</p>
    <p style="font-size:13px;color:#6B7280;margin:8px 0 0 0;">
      In the review workspace you can open the document, add your comments, select an outcome code, and submit your review.
      ${params.totalReviewers > 1 ? `Your review will be forwarded to the next reviewer in the sequence.` : 'Your review is the final review for this document.'}
    </p>
  `)
}

/**
 * Batch review assignment email — ONE email per reviewer listing ALL documents.
 * Replaces the per-document email for the initial reviewer notification.
 * Link opens the first document's review workspace (batch tabs let reviewer navigate the rest).
 */
export function batchReviewAssignedEmail(params: {
  reviewerName:   string
  firstTaskId:    string
  packageName:    string
  documents:      Array<{ fileName: string; docTitle: string; taskId: string }>
  dueDate:        string | null
  sequencePos:    number
  totalReviewers: number
  instructions:   string
}): string {
  const reviewUrl = `${APP_URL}/reviews/${params.firstTaskId}`

  const docRows = params.documents.map((d, i) =>
    `<tr style="border-top:1px solid #E5E7EB;">
      <td style="padding:6px 8px;font-size:13px;color:#6B7280;font-weight:700;width:32px;vertical-align:top;">${i + 1}.</td>
      <td style="padding:6px 8px;font-size:13px;color:#374151;word-break:break-all;">
        <span style="font-family:monospace;font-size:12px;">${d.fileName}</span>
        ${d.docTitle && d.docTitle !== d.fileName ? `<br><span style="font-size:12px;color:#6B7280;font-family:Calibri,Arial,sans-serif;">${d.docTitle}</span>` : ''}
      </td>
    </tr>`
  ).join('')

  const rows: Array<[string, string]> = [
    ['Package', params.packageName],
    ['Documents', `${params.documents.length} document${params.documents.length !== 1 ? 's' : ''}`],
    ['Reviewer Position', `${params.sequencePos} of ${params.totalReviewers}`],
  ]
  if (params.dueDate) {
    rows.push(['Due Date', `<strong style="color:#DC2626;">${new Date(params.dueDate).toLocaleDateString('en-ZA', { day:'numeric', month:'long', year:'numeric' })}</strong>`])
  }

  return layout(`Review Required: ${params.packageName} — ${params.documents.length} document${params.documents.length !== 1 ? 's' : ''}`, `
    <p style="margin:0 0 16px 0;">Dear ${params.reviewerName},</p>
    <p style="margin:0 0 16px 0;">You have been assigned a batch of <strong>${params.documents.length} document${params.documents.length !== 1 ? 's' : ''}</strong> for review.
    Please review each document individually and submit your outcome for all of them.</p>
    ${metaTable(rows)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid #E5E7EB;border-radius:6px;margin:12px 0 0 0;">
      <tr><td style="padding:12px 12px 4px 12px;">
        <p style="margin:0 0 8px 0;font-family:Calibri,Arial,sans-serif;font-size:13px;font-weight:700;color:#374151;">Documents to review:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${docRows}</table>
      </td></tr>
    </table>
    ${params.instructions ? calloutBlock(`<strong>Instructions from Document Controller:</strong><br>${params.instructions}`) : ''}
    <p style="margin:16px 0 0 0;">${ctaButtonHtml(reviewUrl, 'Open Review Workspace')}</p>
    <p style="font-size:13px;color:#6B7280;margin:8px 0 0 0;">
      In the review workspace you can navigate between all documents in the batch using the tabs at the top.
      Review each document individually — the batch is only considered complete once all documents are reviewed.
      ${params.totalReviewers > 1 ? 'Once all documents are reviewed, the batch will be forwarded to the next reviewer.' : 'Your review is the final review for this batch.'}
    </p>
  `)
}

export function vendorTransmittalEmail(params: {
  vendorName:         string
  packageCode:        string
  packageName:        string
  transmittalNumber:  string
  transmittalDate:    string   // formatted e.g. "7 June 2026"
  overallCode:        string
  overallText:        string
  documents:          Array<{ fileName: string; docName: string | null; outcomeCode: string }>
  vendorPortalUrl:    string   // SharePoint "To Vendor" folder link
  controllerName:     string
  controllerEmail:    string
}): string {
  const outcomeColors: Record<string, string> = {
    A1:'#16A34A', D1:'#2563EB', B1:'#D97706', B2:'#EA580C', C1:'#DC2626', Q1:'#DC2626', V1:'#6B7280', S1:'#6B7280',
  }
  const color = outcomeColors[params.overallCode] ?? '#374151'

  const docRows = params.documents.map((d, i) => `
    <tr style="border-top:1px solid #E5E7EB;">
      <td style="padding:6px 8px;font-size:13px;color:#6B7280;font-weight:700;width:24px;text-align:center;vertical-align:top;">${i+1}</td>
      <td style="padding:6px 8px;font-size:12px;color:#374151;font-family:monospace;word-break:break-all;vertical-align:top;">${d.fileName}</td>
      <td style="padding:6px 8px;font-size:13px;color:#374151;vertical-align:top;">${d.docName ?? ''}</td>
      <td style="padding:6px 8px;font-size:13px;font-weight:700;color:${outcomeColors[d.outcomeCode]??'#374151'};text-align:center;vertical-align:top;">${d.outcomeCode}</td>
    </tr>`).join('')

  return layout(`Document Review Transmittal — ${params.transmittalNumber}`, `
    <p style="margin:0 0 16px 0;">Dear ${params.vendorName},</p>
    <p style="margin:0 0 16px 0;">Please find attached the Document Review Transmittal for <strong>${params.packageCode} — ${params.packageName}</strong>.
    This transmittal summarises the review outcomes for the documents listed below.</p>

    ${metaTable([
      ['Transmittal Number', `<strong>${params.transmittalNumber}</strong>`],
      ['Date', params.transmittalDate],
      ['Package', `${params.packageCode} — ${params.packageName}`],
      ['Overall Outcome', `<strong style="color:${color};font-size:15px;">${params.overallCode}</strong> &nbsp; ${params.overallText}`],
    ])}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid #E5E7EB;border-radius:6px;margin:12px 0 0 0;">
      <tr><td style="padding:12px 12px 4px 12px;">
        <p style="margin:0 0 8px 0;font-family:Calibri,Arial,sans-serif;font-size:13px;font-weight:700;color:#374151;">Documents reviewed:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr style="background-color:#F3F4F6;">
            <th align="left" style="padding:6px 8px;font-size:12px;color:#6B7280;font-weight:700;width:24px;">#</th>
            <th align="left" style="padding:6px 8px;font-size:12px;color:#6B7280;font-weight:700;">File Name</th>
            <th align="left" style="padding:6px 8px;font-size:12px;color:#6B7280;font-weight:700;">Document Title</th>
            <th align="center" style="padding:6px 8px;font-size:12px;color:#6B7280;font-weight:700;">Code</th>
          </tr>
          ${docRows}
        </table>
      </td></tr>
    </table>

    ${calloutBlock(`
      <p style="margin:0 0 6px 0;font-weight:700;">Marked-Up Documents</p>
      <p style="margin:0;font-size:13px;">
        The marked-up and reviewed documents are available for download from your vendor portal:
        <br><br>
        <a href="${params.vendorPortalUrl}" style="color:#1D4ED8;word-break:break-all;">${params.vendorPortalUrl}</a>
        <br><br>
        Documents were submitted to your portal on <strong>${params.transmittalDate}</strong>.
      </p>
    `)}

    <p style="margin-top:16px;font-size:13px;color:#374151;">
      Please review the attached transmittal document for full details including individual reviewer comments.
      Action required will depend on the review code assigned to each document.
      Contact us if you have any questions regarding the review outcomes.
    </p>

    <p style="margin-top:16px;font-size:13px;">
      Kind regards,<br>
      <strong>${params.controllerName}</strong><br>
      PPE Tech — Document Control<br>
      <a href="mailto:${params.controllerEmail}">${params.controllerEmail}</a>
    </p>
  `)
}

export function reviewCompleteEmail(params: {
  batchId:          string
  packageName:      string
  finalOutcomeCode: string
  reviewerCount:    number
}): string {
  const batchUrl = `${APP_URL}/batches/${params.batchId}`
  const outcomeColors: Record<string, string> = {
    A1:'#16A34A', B1:'#D97706', B2:'#EA580C', C1:'#DC2626', D1:'#2563EB', Q1:'#DC2626',
  }
  const color = outcomeColors[params.finalOutcomeCode] ?? '#374151'

  return layout('Review Complete — Action Required', `
    <p style="margin:0 0 16px 0;">All reviewers have completed their review for the following batch. The transmittal is ready to be generated.</p>
    ${metaTable([
      ['Package', params.packageName],
      ['Reviewers', `${params.reviewerCount} reviewer${params.reviewerCount !== 1 ? 's' : ''}`],
      ['Final Outcome', `<strong style="color:${color};font-size:16px;">${params.finalOutcomeCode}</strong>`],
    ])}
    <p style="margin:16px 0 0 0;">${ctaButtonHtml(batchUrl, 'Open Batch in Document Control')}</p>
    <p style="font-size:13px;color:#6B7280;margin:8px 0 0 0;">Please review the completed feedback, generate the transmittal document, and return to the vendor when ready.</p>
  `)
}
