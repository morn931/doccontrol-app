/**
 * Email template builder for document control notifications.
 * All templates return HTML strings for use with the Graph API sendEmail service.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// Coreflow-branded chrome shared by every CoreDocs notification: navy header with the
// inline logo (cid:coreflowmark, auto-attached by coreflow-mail.sendMail) + "CoreDocs"
// module chip, teal accent, white card, muted footer. `title` renders as the body heading.
function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #eef1f5; margin: 0; padding: 28px 12px; }
  .container { max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(16,24,40,0.08); }
  .header { background: #1B3464; padding: 18px 26px; }
  .accent { height: 3px; background: linear-gradient(90deg,#00B8C4,#0097A3); font-size:0; line-height:0; }
  .body { padding: 30px; }
  .body h1 { color:#1B3464; font-size:19px; font-weight:700; margin:0 0 16px; }
  .body p  { color: #374151; line-height: 1.6; margin: 0 0 16px; font-size: 14px; }
  .meta { background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 6px; padding: 16px; margin: 20px 0; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { padding: 5px 8px; font-size: 13px; color: #374151; vertical-align: top; }
  .meta td:first-child { font-weight: 600; color: #6B7280; white-space: nowrap; width: 140px; }
  .btn { display: inline-block; background: #00B8C4; color: #ffffff !important; padding: 11px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 8px 0; }
  .btn-danger { background: #DC2626; }
  .footer { padding: 16px 30px; background: #f7f9fb; border-top: 1px solid #edf0f3; color: #9aa4b2; font-size: 11px; line-height: 1.5; }
  .summary { background: #EFF6FF; border-left: 4px solid #3B82F6; padding: 12px 16px; border-radius: 0 6px 6px 0; margin: 16px 0; font-size: 13px; color: #1E40AF; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle">
        <img src="cid:coreflowmark" width="26" height="26" alt="" style="vertical-align:middle;display:inline-block;border:0"/>
        <span style="vertical-align:middle;color:#ffffff;font-size:17px;font-weight:700;letter-spacing:0.4px;padding-left:9px">Coreflow</span>
      </td>
      <td style="vertical-align:middle;text-align:right">
        <span style="display:inline-block;background:rgba(0,184,196,0.18);color:#7fe3ec;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:5px 11px;border-radius:999px">CoreDocs</span>
      </td>
    </tr></table>
  </div>
  <div class="accent">&nbsp;</div>
  <div class="body"><h1>${title}</h1>${body}</div>
  <div class="footer">Automated message from <span style="color:#1B3464;font-weight:600">Coreflow</span> — CoreDocs. Please don't reply to this address.<br/>Coreflow · project delivery platform · <a href="https://coreflow.build" style="color:#0097A3;text-decoration:none">coreflow.build</a></div>
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
      <td style="padding:6px 8px;font-size:13px;color:#6B7280;font-weight:600;width:24px;text-align:center;">${i+1}</td>
      <td style="padding:6px 8px;font-size:12px;color:#374151;font-family:monospace;">${d.fileName}</td>
      <td style="padding:6px 8px;font-size:13px;color:#374151;">${d.docName ?? ''}</td>
      <td style="padding:6px 8px;font-size:13px;font-weight:700;color:${outcomeColors[d.outcomeCode]??'#374151'};text-align:center;">${d.outcomeCode}</td>
    </tr>`).join('')

  return layout(`Document Review Transmittal — ${params.transmittalNumber}`, `
    <p>Dear ${params.vendorName},</p>
    <p>Please find attached the Document Review Transmittal for <strong>${params.packageCode} — ${params.packageName}</strong>.
    This transmittal summarises the review outcomes for the documents listed below.</p>

    <div class="meta"><table>
      <tr><td>Transmittal Number</td><td><strong>${params.transmittalNumber}</strong></td></tr>
      <tr><td>Date</td><td>${params.transmittalDate}</td></tr>
      <tr><td>Package</td><td>${params.packageCode} — ${params.packageName}</td></tr>
      <tr><td>Overall Outcome</td><td><strong style="color:${color};font-size:15px;">${params.overallCode}</strong> &nbsp; ${params.overallText}</td></tr>
    </table></div>

    <div class="meta" style="margin-top:12px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Documents reviewed:</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="background:#F3F4F6;">
          <th style="padding:6px 8px;font-size:12px;color:#6B7280;font-weight:600;text-align:left;width:24px;">#</th>
          <th style="padding:6px 8px;font-size:12px;color:#6B7280;font-weight:600;text-align:left;">File Name</th>
          <th style="padding:6px 8px;font-size:12px;color:#6B7280;font-weight:600;text-align:left;">Document Title</th>
          <th style="padding:6px 8px;font-size:12px;color:#6B7280;font-weight:600;text-align:center;">Code</th>
        </tr>
        ${docRows}
      </table>
    </div>

    <div class="summary" style="margin-top:16px;">
      <p style="margin:0 0 6px;font-weight:600;">Marked-Up Documents</p>
      <p style="margin:0;font-size:13px;">
        The marked-up and reviewed documents are available for download from your vendor portal:
        <br><br>
        <a href="${params.vendorPortalUrl}" style="color:#1D4ED8;">${params.vendorPortalUrl}</a>
        <br><br>
        Documents were submitted to your portal on <strong>${params.transmittalDate}</strong>.
      </p>
    </div>

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
