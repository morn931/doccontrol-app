/**
 * Email template builder for document control notifications.
 * All templates return HTML strings for use with the Graph API sendEmail service.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px; }
  .container { max-width: 640px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .header { background: #1E4A8F; padding: 24px 32px; }
  .header h1 { color: white; margin: 0; font-size: 20px; font-weight: 600; }
  .header p  { color: #93b4e0; margin: 4px 0 0; font-size: 13px; }
  .body { padding: 32px; }
  .body p  { color: #374151; line-height: 1.6; margin: 0 0 16px; }
  .meta { background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 6px; padding: 16px; margin: 20px 0; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { padding: 5px 8px; font-size: 13px; color: #374151; vertical-align: top; }
  .meta td:first-child { font-weight: 600; color: #6B7280; white-space: nowrap; width: 140px; }
  .btn { display: inline-block; background: #1E4A8F; color: white !important; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 8px 0; }
  .btn-danger { background: #DC2626; }
  .footer { padding: 20px 32px; border-top: 1px solid #E5E7EB; color: #9CA3AF; font-size: 12px; }
  .summary { background: #EFF6FF; border-left: 4px solid #3B82F6; padding: 12px 16px; border-radius: 0 6px 6px 0; margin: 16px 0; font-size: 13px; color: #1E40AF; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>PPE Tech Document Control</h1><p>EPCM Document Management Platform</p></div>
  <div class="body">${body}</div>
  <div class="footer">This is an automated notification from the PPE Tech Document Control system. Do not reply to this email.</div>
</div>
</body>
</html>`
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
  const fileList  = params.fileNames.map(f => `<li style="margin:4px 0;">${f}</li>`).join('')

  return layout('New Document Batch Received', `
    <p>A new document batch has been received from <strong>${params.vendorCode}</strong> and is ready for your review.</p>
    <div class="meta"><table>
      <tr><td>Package</td><td>${params.packageName}</td></tr>
      <tr><td>Vendor</td><td>${params.vendorCode}</td></tr>
      <tr><td>Files</td><td><ul style="margin:0;padding-left:16px;">${fileList}</ul></td></tr>
      <tr><td>Discipline</td><td>${params.discipline || 'Pending'}</td></tr>
      <tr><td>Document Type</td><td>${params.docType || 'Pending'}</td></tr>
    </table></div>
    ${params.aiSummary ? `<div class="summary"><strong>AI Summary:</strong><br>${params.aiSummary}</div>` : ''}
    <p><a href="${batchUrl}" class="btn">Open Batch in Document Control</a></p>
    <p style="font-size:13px;color:#6B7280;">Please review the documents, confirm the AI classification, and assign reviewers to begin the formal review process.</p>
  `)
}

export function batchRejectedEmail(params: {
  packageName: string
  vendorCode:  string
  fileNames:   string[]
  rejectReason: string
  controllerEmail: string
}): string {
  const fileList = params.fileNames.map(f => `<li style="margin:4px 0;">${f}</li>`).join('')

  return layout('Document Batch Rejected — Action Required', `
    <p>Your document batch submitted to <strong>${params.packageName}</strong> has been rejected by PPE Tech Document Control before formal review.</p>
    <div class="meta"><table>
      <tr><td>Package</td><td>${params.packageName}</td></tr>
      <tr><td>Files</td><td><ul style="margin:0;padding-left:16px;">${fileList}</ul></td></tr>
    </table></div>
    <div class="summary" style="background:#FEF2F2;border-color:#EF4444;color:#991B1B;">
      <strong>Rejection Reason:</strong><br>${params.rejectReason}
    </div>
    <p>Please delete the current versions from your SharePoint drop-off folder and upload corrected documents as a new batch.</p>
    <p style="font-size:13px;color:#6B7280;">If you have questions, please contact the Document Controller at ${params.controllerEmail}</p>
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
  const dueLine   = params.dueDate
    ? `<tr><td>Due Date</td><td><strong style="color:#DC2626;">${new Date(params.dueDate).toLocaleDateString('en-ZA', { day:'numeric', month:'long', year:'numeric' })}</strong></td></tr>`
    : ''

  return layout(`Review Required: ${params.docTitle}`, `
    <p>Dear ${params.reviewerName},</p>
    <p>You have been assigned a document for ${params.isManagerOverride ? '<strong>engineering review (additional review requested)</strong>' : 'review'}. Please review and submit your outcome by the due date.</p>
    <div class="meta"><table>
      <tr><td>Package</td><td>${params.packageName}</td></tr>
      <tr><td>Document</td><td><strong>${params.docTitle}</strong></td></tr>
      <tr><td>File Name</td><td><span style="font-family:monospace;">${params.fileName}</span></td></tr>
      <tr><td>Reviewer Position</td><td>${params.sequencePos} of ${params.totalReviewers}</td></tr>
      ${dueLine}
    </table></div>
    ${params.instructions ? `<div class="summary"><strong>Instructions from Document Controller:</strong><br>${params.instructions}</div>` : ''}
    <p><a href="${reviewUrl}" class="btn">Open Review Workspace</a></p>
    <p style="font-size:13px;color:#6B7280;">
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
  const dueLine = params.dueDate
    ? `<tr><td>Due Date</td><td><strong style="color:#DC2626;">${new Date(params.dueDate).toLocaleDateString('en-ZA', { day:'numeric', month:'long', year:'numeric' })}</strong></td></tr>`
    : ''

  const docRows = params.documents.map((d, i) =>
    `<tr style="border-top:1px solid #E5E7EB;">
      <td style="padding:6px 8px;font-size:13px;color:#6B7280;font-weight:600;width:32px;">${i + 1}.</td>
      <td style="padding:6px 8px;font-size:13px;color:#374151;">
        <span style="font-family:monospace;font-size:12px;">${d.fileName}</span>
        ${d.docTitle && d.docTitle !== d.fileName ? `<br><span style="font-size:12px;color:#6B7280;">${d.docTitle}</span>` : ''}
      </td>
    </tr>`
  ).join('')

  return layout(`Review Required: ${params.packageName} — ${params.documents.length} document${params.documents.length !== 1 ? 's' : ''}`, `
    <p>Dear ${params.reviewerName},</p>
    <p>You have been assigned a batch of <strong>${params.documents.length} document${params.documents.length !== 1 ? 's' : ''}</strong> for review.
    Please review each document individually and submit your outcome for all of them.</p>
    <div class="meta"><table>
      <tr><td>Package</td><td>${params.packageName}</td></tr>
      <tr><td>Documents</td><td>${params.documents.length} document${params.documents.length !== 1 ? 's' : ''}</td></tr>
      <tr><td>Reviewer Position</td><td>${params.sequencePos} of ${params.totalReviewers}</td></tr>
      ${dueLine}
    </table></div>
    <div class="meta" style="margin-top:12px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Documents to review:</p>
      <table style="width:100%;border-collapse:collapse;">${docRows}</table>
    </div>
    ${params.instructions ? `<div class="summary"><strong>Instructions from Document Controller:</strong><br>${params.instructions}</div>` : ''}
    <p><a href="${reviewUrl}" class="btn">Open Review Workspace</a></p>
    <p style="font-size:13px;color:#6B7280;">
      In the review workspace you can navigate between all documents in the batch using the tabs at the top.
      Review each document individually — the batch is only considered complete once all documents are reviewed.
      ${params.totalReviewers > 1 ? 'Once all documents are reviewed, the batch will be forwarded to the next reviewer.' : 'Your review is the final review for this batch.'}
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
    <p>All reviewers have completed their review for the following batch. The transmittal is ready to be generated.</p>
    <div class="meta"><table>
      <tr><td>Package</td><td>${params.packageName}</td></tr>
      <tr><td>Reviewers</td><td>${params.reviewerCount} reviewer${params.reviewerCount !== 1 ? 's' : ''}</td></tr>
      <tr><td>Final Outcome</td><td><strong style="color:${color};font-size:16px;">${params.finalOutcomeCode}</strong></td></tr>
    </table></div>
    <p><a href="${batchUrl}" class="btn">Open Batch in Document Control</a></p>
    <p style="font-size:13px;color:#6B7280;">Please review the completed feedback, generate the transmittal document, and return to the vendor when ready.</p>
  `)
}
