import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { vendorTransmittalEmail } from '@/lib/services/email-templates'
import { setApproverPicksReturnRequested } from '@/lib/services/sharepoint-lists'
import { OUTCOME_CODES } from '@/lib/utils/outcome-codes'
import { logActivity } from '@/lib/activity'
import { format } from 'date-fns'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY: Record<string, number> = { A1:1,D1:2,B1:3,B2:4,C1:5,Q1:6,V1:7,S1:8 }
function worstCode(codes: string[]): string {
  return codes.filter(Boolean).sort((a,b) => (SEVERITY[b]??0)-(SEVERITY[a]??0))[0] ?? 'A1'
}
function outcomeText(code: string): string {
  return (OUTCOME_CODES as any)[code]?.text ?? code
}

async function nextTransmittalNumber(db: any): Promise<string> {
  const year = new Date().getFullYear()
  const { data: seq } = await db.from('transmittal_sequences').select('last_seq').eq('year', year).single()
  let next: number
  if (!seq) {
    await db.from('transmittal_sequences').insert({ year, last_seq: 1 })
    next = 1
  } else {
    next = seq.last_seq + 1
    await db.from('transmittal_sequences').update({ last_seq: next }).eq('year', year)
  }
  return `PPE-TRN-${year}-${String(next).padStart(5,'0')}`
}

// ─── Outcome colour helpers ───────────────────────────────────────────────────

function oBg(code: string) {
  return ({ A1:'#E8F5E9',D1:'#E3F2FD',B1:'#FFF9C4',B2:'#FFE0B2',C1:'#FFCDD2',Q1:'#FFCDD2',V1:'#EEEEEE',S1:'#EEEEEE' } as any)[code] ?? '#F2F4F6'
}
function oFg(code: string) {
  return ({ A1:'#1B5E20',D1:'#0D47A1',B1:'#F57F17',B2:'#BF360C',C1:'#B71C1C',Q1:'#B71C1C',V1:'#424242',S1:'#424242' } as any)[code] ?? '#111111'
}

// ─── PDF builder using PDFKit (no font files, works in Vercel serverless) ─────

// Compose a reviewer's transmittal comment = their outcome comment + captured in-app
// text mark-ups (structured, from document_markups).
function composeComment(outcomeComment: string | null, captured?: string[]): string {
  const parts: string[] = []
  if (outcomeComment) parts.push(outcomeComment)
  if (captured?.length) parts.push('Mark-ups: ' + captured.join('; '))
  return parts.join('\n')
}

// Map `${document_version_id}::${author_email}` → captured text comments. This is the
// structured source that replaces the old Azure PDF-decipher step. Empty (graceful) if
// the document_markups table isn't present yet.
async function capturedCommentMap(db: any, dvIds: string[]): Promise<Record<string, string[]>> {
  if (!dvIds.length) return {}
  const { data } = await db.from('document_markups')
    .select('document_version_id, author_email, comments')
    .in('document_version_id', dvIds)
  const map: Record<string, string[]> = {}
  for (const m of data ?? []) {
    const texts = Array.isArray(m.comments) ? m.comments.map((c: any) => String(c?.text ?? '').trim()).filter(Boolean) : []
    if (texts.length) map[`${m.document_version_id}::${m.author_email}`] = texts
  }
  return map
}

async function buildTransmittalPdf(data: TransmittalData): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDoc = require('pdfkit') as any

  const BLUE = '#003087', LGRAY = '#F2F4F6', MGRAY = '#CCCCCC'
  const M = 40, PW = 595.28, PH = 841.89
  const CW = PW - M * 2        // 515.28
  const RH = 18                 // standard row height
  const PAGE_BOTTOM = PH - 38  // leave room for footer

  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDoc({ size: 'A4', margin: M, bufferPages: true, autoFirstPage: true })
    const chunks: Buffer[] = []
    pdf.on('data', (c: Buffer) => chunks.push(c))
    pdf.on('end',  () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)

    // ── Estimate wrapped text height ──────────────────────────────────────────
    function calcH(text: string, w: number, fs = 7.5): number {
      if (!text) return RH
      const charsPerLine = Math.max(1, Math.floor((w - 8) / (fs * 0.55)))
      const lines = Math.ceil(text.length / charsPerLine)
      return Math.max(RH, lines * (fs + 4) + 6)
    }

    // ── Ensure enough vertical space; add page if needed ─────────────────────
    function ensureSpace(currentY: number, needed: number): number {
      if (currentY + needed > PAGE_BOTTOM) {
        pdf.addPage()
        return M
      }
      return currentY
    }

    // ── Draw a table cell ─────────────────────────────────────────────────────
    function cell(x: number, y: number, w: number, h: number, text: string, opts: {
      fill?: string; fg?: string; bold?: boolean; align?: 'left'|'center'|'right'
      fs?: number; wrap?: boolean
    } = {}) {
      pdf.rect(x, y, w, h).fill(opts.fill ?? '#FFFFFF')
      pdf.rect(x, y, w, h).lineWidth(0.4).stroke(MGRAY)
      if (!text) return
      const fs   = opts.fs ?? 7.5
      const wrap = opts.wrap ?? false
      const ty   = y + (wrap ? 4 : (h - fs) / 2)
      pdf.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(fs).fillColor(opts.fg ?? '#111111')
         .text(String(text), x + 4, ty, {
           width: w - 8, align: opts.align ?? 'left',
           lineBreak: wrap, ...(wrap ? {} : { ellipsis: true }),
         })
    }

    function sectionHdr(y: number, text: string): number {
      pdf.rect(M, y, CW, RH + 2).fill(BLUE)
      pdf.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF')
         .text(text, M + 6, y + 5, { width: CW - 12, lineBreak: false })
      return y + RH + 2
    }

    // ── Page 1: Title + Info + Summary ────────────────────────────────────────
    let y = M

    // Title block
    pdf.rect(M, y, CW, 48).fill(BLUE)
    pdf.font('Helvetica-Bold').fontSize(15).fillColor('#FFFFFF').text('PPE TECH', M + 8, y + 8)
    pdf.font('Helvetica').fontSize(8.5).fillColor('#AACCEE').text('Document Control System', M + 8, y + 28)
    pdf.font('Helvetica-Bold').fontSize(9.5).fillColor('#FFFFFF')
       .text('DOCUMENT TRANSMITTAL', M, y + 16, { width: CW - 10, align: 'right' })
    y += 60

    // Info table
    y = sectionHdr(y, 'TRANSMITTAL INFORMATION')
    const IC1 = 125, IC2 = CW - IC1
    const infoRows = [
      ['Transmittal Number', data.transmittalNumber, true],
      ['Date',               format(new Date(), 'd MMMM yyyy'), false],
      ['Vendor',             data.vendorName, false],
      ['Project Package',    `${data.packageCode}  —  ${data.packageName}`, false],
      ['No. of Documents',   String(data.documents.length), false],
      ['Overall Outcome',    `${data.overallCode}  —  ${outcomeText(data.overallCode)}`, true],
      ['Prepared By',        data.controllerEmail, false],
    ]
    for (let i = 0; i < infoRows.length; i++) {
      const altFill = i % 2 === 0 ? LGRAY : '#FFFFFF'
      cell(M,       y, IC1, RH, String(infoRows[i][0]), { fill: LGRAY, bold: true })
      cell(M + IC1, y, IC2, RH, String(infoRows[i][1]), { fill: altFill, bold: !!infoRows[i][2], fg: i === 5 ? oFg(data.overallCode) : '#111111' })
      y += RH
    }
    y += 10

    // Document summary
    y = sectionHdr(y, 'DOCUMENT SUMMARY')
    const SC = [18, 138, CW - 18 - 138 - 24 - 34, 24, 34]
    const SX = [M, M+SC[0], M+SC[0]+SC[1], M+SC[0]+SC[1]+SC[2], M+SC[0]+SC[1]+SC[2]+SC[3]]
    const hdrs = ['#','Document Number','Document Title','Rev','Code']
    hdrs.forEach((h, i) => cell(SX[i], y, SC[i], RH, h, { fill: '#D0DCF0', bold: true, align: i===0||i>=3?'center':'left' }))
    y += RH
    for (let i = 0; i < data.documents.length; i++) {
      const d = data.documents[i]
      const f = i % 2 === 0 ? LGRAY : '#FFFFFF'
      cell(SX[0], y, SC[0], RH, String(i+1),             { fill: f, align: 'center' })
      cell(SX[1], y, SC[1], RH, d.fileName,               { fill: f, fs: 7 })
      cell(SX[2], y, SC[2], RH, d.docName ?? d.fileName,  { fill: f })
      cell(SX[3], y, SC[3], RH, d.revision ?? '0',        { fill: f, align: 'center' })
      cell(SX[4], y, SC[4], RH, d.outcomeCode,            { fill: oBg(d.outcomeCode), fg: oFg(d.outcomeCode), bold: true, align: 'center' })
      y += RH
    }

    // ── Per-document sections (packed — new page only when space runs out) ────
    // Reviewer table columns: widened Code col (38px), Description (136px)
    const RC = [100, 38, 136, CW - 100 - 38 - 136]
    const RX = [M, M+RC[0], M+RC[0]+RC[1], M+RC[0]+RC[1]+RC[2]]

    for (let i = 0; i < data.documents.length; i++) {
      const d = data.documents[i]

      // Pre-calculate each reviewer row height based on longest wrapping cell
      const reviewerRowHeights = d.reviewers.map(rv =>
        Math.max(RH,
          calcH(rv.name,              RC[0]),
          calcH(outcomeText(rv.code), RC[2]),
          calcH(rv.comment || '—',   RC[3]),
        )
      )
      // Minimum height needed to start this document (header + meta + reviewer header)
      const minDocStart = (RH + 2) + 6 + 5 * RH + 8 + 14 + RH + (reviewerRowHeights[0] ?? RH)

      if (i === 0 || y + minDocStart > PAGE_BOTTOM) {
        pdf.addPage()
        y = M
      } else {
        y += 18  // visual gap between documents sharing a page
      }

      y = sectionHdr(y, `DOCUMENT ${i+1} OF ${data.documents.length}  ·  ${d.outcomeCode}: ${outcomeText(d.outcomeCode)}`)
      y += 6

      const DC1 = 105, DC2 = CW - DC1
      const metaRows = [
        ['Document Number', d.fileName],
        ['Document Title',  d.docName ?? d.fileName],
        ['Revision',        d.revision ?? '0'],
        ['Discipline',      [d.discipline, d.documentType, d.topic].filter(Boolean).join('  ·  ') || '—'],
        ['Overall Outcome', `${d.outcomeCode}  —  ${outcomeText(d.outcomeCode)}`],
      ]
      for (let r = 0; r < metaRows.length; r++) {
        y = ensureSpace(y, RH)
        cell(M,       y, DC1, RH, metaRows[r][0], { fill: LGRAY, bold: true })
        cell(M + DC1, y, DC2, RH, metaRows[r][1], { bold: r===4, fg: r===4 ? oFg(d.outcomeCode) : '#111' })
        y += RH
      }
      y += 8

      y = ensureSpace(y, 14 + RH + (reviewerRowHeights[0] ?? RH))
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(BLUE).text('REVIEWER OUTCOMES', M, y, { lineBreak: false })
      y += 14

      ;['Reviewer','Code','Description','Comment'].forEach((h, j) =>
        cell(RX[j], y, RC[j], RH, h, { fill: BLUE, bold: true, fg: '#FFFFFF', align: j===1?'center':'left' })
      )
      y += RH

      for (let r = 0; r < d.reviewers.length; r++) {
        const rv   = d.reviewers[r]
        const rowH = reviewerRowHeights[r]
        y = ensureSpace(y, rowH)
        const f = r % 2 === 0 ? LGRAY : '#FFFFFF'
        cell(RX[0], y, RC[0], rowH, rv.name,              { fill: f, wrap: true })
        cell(RX[1], y, RC[1], rowH, rv.code,              { fill: oBg(rv.code), fg: oFg(rv.code), bold: true, align: 'center' })
        cell(RX[2], y, RC[2], rowH, outcomeText(rv.code), { fill: f, fg: '#555555', wrap: true })
        cell(RX[3], y, RC[3], rowH, rv.comment || '—',   { fill: f, wrap: true })
        y += rowH
      }
    }

    // ── Acknowledgement page (always its own page) ────────────────────────────
    pdf.addPage()
    y = M
    y = sectionHdr(y, 'ACKNOWLEDGEMENT OF RECEIPT')
    y += 8
    pdf.font('Helvetica').fontSize(8).fillColor('#333')
       .text("This transmittal confirms that the above-referenced documents have been reviewed in accordance with PPE Tech's document control procedures. Please action as required based on the review codes provided.", M, y, { width: CW })
    y += 36

    const AC = [80, 140, 140, CW - 80 - 140 - 140]
    const AX = [M, M+AC[0], M+AC[0]+AC[1], M+AC[0]+AC[1]+AC[2]]
    ;['For','Name and Surname','Signature','Date'].forEach((h,j) =>
      cell(AX[j], y, AC[j], RH, h, { fill: BLUE, bold: true, fg: '#FFFFFF' })
    )
    y += RH
    ;['PPE Tech','Client'].forEach(lbl => {
      cell(AX[0], y, AC[0], RH*2, lbl, { fill: LGRAY, bold: true })
      ;[1,2,3].forEach(j => cell(AX[j], y, AC[j], RH*2, ''))
      y += RH * 2
    })
    y += 14

    pdf.font('Helvetica-Bold').fontSize(8).fillColor(BLUE).text('REVIEW CODE LEGEND', M, y, { lineBreak: false })
    y += 12
    Object.values(OUTCOME_CODES).forEach((oc: any, i) => {
      const f = i % 2 === 0 ? LGRAY : '#FFFFFF'
      cell(M,      y, 28,      RH, oc.code, { fill: oBg(oc.code), fg: oFg(oc.code), bold: true, align: 'center' })
      cell(M + 28, y, CW - 28, RH, oc.text, { fill: f })
      y += RH
    })

    // ── Per-page headers/footers ──────────────────────────────────────────────
    const range = pdf.bufferedPageRange()
    for (let p = 0; p < range.count; p++) {
      pdf.switchToPage(p)
      pdf.font('Helvetica').fontSize(7).fillColor('#888888')
      pdf.text(`PPE TECH  ·  Document Control  ·  ${data.transmittalNumber}`, M, 18, { width: CW / 2, lineBreak: false })
      pdf.text(`${data.vendorName}  ·  ${data.packageCode}  ·  Page ${p+1} of ${range.count}`, M + CW/2, 18, { width: CW/2, align: 'right', lineBreak: false })
      pdf.text(`Generated by PPE Tech Document Control System  ·  ${format(new Date(),'d MMMM yyyy')}  ·  Confidential`, M, PH - 25, { width: CW, align: 'center', lineBreak: false })
    }

    pdf.end()
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransmittalDocument {
  fileName:      string
  docName:       string | null
  revision:      string | null
  discipline:    string | null
  documentType:  string | null
  topic:         string | null
  outcomeCode:   string
  markupSummary: string
  reviewers:     { name: string; code: string; comment: string }[]
}
export interface TransmittalData {
  transmittalNumber: string
  vendorName:        string
  packageCode:       string
  packageName:       string
  overallCode:       string
  controllerEmail:   string
  controllerName:    string
  documents:         TransmittalDocument[]
}

// ─── GET — build transmittal preview (no PDF, no email) + email suggestions ───

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id: batchId } = await params
  const db = createServiceClient()

  const { data: batch } = await db.from('batches')
    .select(`id, status, target_library, controller_email, vendor_id, package_id, vendor_email,
             vendors(name), packages(package_name, package_code),
             document_versions(id, file_name, doc_name, doc_unique_id, revision, discipline, document_type, topic)`)
    .eq('id', batchId).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const docVersions = (batch.document_versions as any[]) ?? []

  const { data: allTasks } = await db.from('review_tasks')
    .select('document_version_id, reviewer_email, review_outcome_code, comment, sequence_number')
    .eq('batch_id', batchId).eq('status', 'completed').order('sequence_number', { ascending: true })

  const reviewerEmails = [...new Set((allTasks ?? []).map((t: any) => t.reviewer_email as string))]
  const { data: reviewerUsers } = await db.from('users').select('email, full_name').in('email', reviewerEmails)
  const nameMap: Record<string, string> = {}
  for (const u of reviewerUsers ?? []) { if (u.email) nameMap[u.email] = u.full_name ?? u.email.split('@')[0] }

  const tasksByDv: Record<string, any[]> = {}
  for (const t of allTasks ?? []) {
    if (!tasksByDv[t.document_version_id]) tasksByDv[t.document_version_id] = []
    tasksByDv[t.document_version_id].push(t)
  }

  const capMap = await capturedCommentMap(db, docVersions.map((dv: any) => dv.id))

  const documents: TransmittalDocument[] = docVersions.map((dv: any) => {
    const tasks   = tasksByDv[dv.id] ?? []
    const codes   = tasks.map((t: any) => t.review_outcome_code).filter(Boolean)
    const outCode = worstCode(codes) || 'A1'
    const docCaptured = tasks.flatMap((t: any) => capMap[`${dv.id}::${t.reviewer_email}`] ?? [])
    return {
      fileName: dv.file_name, docName: dv.doc_name, revision: dv.revision,
      discipline: dv.discipline, documentType: dv.document_type, topic: dv.topic,
      outcomeCode: outCode, markupSummary: docCaptured.join('; '),
      reviewers: tasks.map((t: any) => ({
        name:    nameMap[t.reviewer_email] ?? t.reviewer_email.split('@')[0],
        code:    t.review_outcome_code ?? '—',
        comment: composeComment(t.comment, capMap[`${dv.id}::${t.reviewer_email}`]),
      })),
    }
  })

  const overallCode = worstCode(documents.map(d => d.outcomeCode)) || 'A1'

  // Email suggestions for the send modal
  const { data: pastTransmittals } = await db.from('transmittals')
    .select('vendor_email_to').eq('vendor_id', batch.vendor_id)
    .not('vendor_email_to', 'is', null).order('generated_at', { ascending: false }).limit(20)

  const pastEmails = [...new Set([
    (batch as any).vendor_email,
    ...((pastTransmittals ?? []).map((t: any) => t.vendor_email_to)),
  ].filter(Boolean) as string[])]

  return NextResponse.json({
    preview: {
      vendorName:   (batch.vendors as any)?.name ?? '',
      packageCode:  (batch.packages as any)?.package_code ?? '',
      packageName:  (batch.packages as any)?.package_name ?? '',
      overallCode,
      documents,
    },
    pastEmails,
    defaultCc: process.env.CONTROLLER_EMAIL ?? '',
  })
}

// ─── POST — generate PDF, send email, return transmittal data ─────────────────

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('id, role, email, full_name')
    .eq('auth_user_id', user.id).single()
  if (!['admin','document_controller'].includes(profile?.role ?? ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: batchId } = await params
  const body = await req.json()
  const { toEmail: rawTo, ccEmails: rawCc = [] }: { toEmail: string; ccEmails: string[] } = body
  const toEmail  = rawTo?.trim()
  const ccEmails = (rawCc as string[]).map((e: string) => e.trim()).filter(Boolean)

  if (!toEmail) return NextResponse.json({ error: 'Vendor email is required' }, { status: 400 })

  const db = createServiceClient()

  const { data: batch } = await db.from('batches')
    .select(`id, batch_guid, status, target_library, controller_email, comments,
             vendor_id, package_id, source_site_url,
             vendors(name), packages(package_name, package_code),
             document_versions(id, file_name, doc_name, doc_unique_id, central_file_url,
                               revision, discipline, document_type, topic)`)
    .eq('id', batchId).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (!['review_complete','transmittal_generated'].includes(batch.status))
    return NextResponse.json({ error: 'Batch not ready for transmittal' }, { status: 400 })

  const docVersions = (batch.document_versions as any[]) ?? []

  const { data: allTasks } = await db.from('review_tasks')
    .select('document_version_id, reviewer_email, review_outcome_code, comment, sequence_number')
    .eq('batch_id', batchId).eq('status','completed').order('sequence_number',{ascending:true})

  const reviewerEmails = [...new Set((allTasks ?? []).map((t:any) => t.reviewer_email as string))]
  const { data: reviewerUsers } = await db.from('users').select('email, full_name').in('email', reviewerEmails)
  const nameMap: Record<string,string> = {}
  for (const u of reviewerUsers ?? []) { if (u.email) nameMap[u.email] = u.full_name ?? u.email.split('@')[0] }

  // Reviewer mark-ups now come from the in-app editor as structured text (captured in
  // document_markups) and are folded into each reviewer's comment below — no PDF
  // decipher / Azure extraction step.

  const tasksByDv: Record<string, any[]> = {}
  for (const t of allTasks ?? []) {
    if (!tasksByDv[t.document_version_id]) tasksByDv[t.document_version_id] = []
    tasksByDv[t.document_version_id].push(t)
  }

  const capMap = await capturedCommentMap(db, docVersions.map((dv: any) => dv.id))

  const documents: TransmittalDocument[] = docVersions.map((dv: any) => {
    const tasks   = tasksByDv[dv.id] ?? []
    const codes   = tasks.map((t: any) => t.review_outcome_code).filter(Boolean)
    const outCode = worstCode(codes) || 'A1'
    const docCaptured = tasks.flatMap((t: any) => capMap[`${dv.id}::${t.reviewer_email}`] ?? [])
    return {
      fileName: dv.file_name, docName: dv.doc_name, revision: dv.revision,
      discipline: dv.discipline, documentType: dv.document_type, topic: dv.topic,
      outcomeCode: outCode, markupSummary: docCaptured.join('; '),
      reviewers: tasks.map((t: any) => ({
        name:    nameMap[t.reviewer_email] ?? t.reviewer_email.split('@')[0],
        code:    t.review_outcome_code ?? '—',
        comment: composeComment(t.comment, capMap[`${dv.id}::${t.reviewer_email}`]),
      })),
    }
  })

  const overallCode    = worstCode(documents.map(d => d.outcomeCode)) || 'A1'
  const vendorName     = (batch.vendors as any)?.name ?? 'Vendor'
  const packageCode    = (batch.packages as any)?.package_code ?? ''
  const packageName    = (batch.packages as any)?.package_name ?? ''
  const controllerEmail = (profile?.email ?? batch.controller_email ?? '').trim()
  const controllerName  = profile?.full_name ?? controllerEmail.split('@')[0]
  const transmittalNumber = await nextTransmittalNumber(db)
  const transmittalDate   = format(new Date(), 'd MMMM yyyy')

  const transmittalData: TransmittalData = {
    transmittalNumber, vendorName, packageCode, packageName,
    overallCode, controllerEmail, controllerName, documents,
  }

  // Generate PDF
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await buildTransmittalPdf(transmittalData)
  } catch (e: any) {
    console.error('PDF generation error:', e)
    return NextResponse.json({ error: `PDF generation failed: ${e.message}` }, { status: 500 })
  }

  // Vendor portal URL — use env var or the batch source_site_url as fallback
  const vendorPortalUrl = process.env.VENDOR_PORTAL_URL ?? (batch as any).source_site_url ?? 'your SharePoint vendor portal'

  // Send email
  const emailHtml = vendorTransmittalEmail({
    vendorName, packageCode, packageName, transmittalNumber, transmittalDate,
    overallCode, overallText: outcomeText(overallCode),
    documents: documents.map(d => ({ fileName:d.fileName, docName:d.docName, outcomeCode:d.outcomeCode })),
    vendorPortalUrl,
    controllerName, controllerEmail,
  })

  await sendEmail({
    to: toEmail,
    cc: [controllerEmail, ...ccEmails].filter(Boolean),
    subject: `Document Review Transmittal — ${transmittalNumber} — ${packageCode} ${packageName}`,
    htmlBody: emailHtml,
    attachments: [{ name: `${transmittalNumber}.pdf`, contentType: 'application/pdf', content: pdfBuffer }],
  })

  // Trigger the existing Logic App return-to-vendor flow.
  // Awaited before responding — Vercel kills fire-and-forget tasks when response is sent.
  // A failure here logs a warning but does NOT fail the transmittal response.
  try {
    // Look up the authoritative vendor site root URL from the vendor registry.
    let sourceSiteUrl: string | null = null
    if (batch.package_id) {
      const { data: vendorSite } = await db
        .from('vendor_sites')
        .select('site_url')
        .eq('package_id', batch.package_id)
        .eq('active', true)
        .single()
      sourceSiteUrl = vendorSite?.site_url ?? null
    }
    // Fall back: strip library path from batch.source_site_url to get site root
    if (!sourceSiteUrl && (batch as any).source_site_url) {
      const raw: string = (batch as any).source_site_url
      const m = raw.match(/^(https:\/\/[^/]+\/sites\/[^/?#]+)/)
      sourceSiteUrl = m ? m[1] : raw
    }
    const returnResult = await setApproverPicksReturnRequested(batch.batch_guid, sourceSiteUrl)
    if (!returnResult.ok) console.warn('Return-to-vendor trigger warning:', returnResult.error)
    else console.log('Return-to-vendor: ReturnRequested=true set on Approver Picks item')
  } catch (e: any) {
    console.warn('Return-to-vendor trigger error:', e?.message)
  }

  // Store transmittal record. generated_by is a UUID FK to users(id) — must be the
  // user's id, NOT their email (an email here fails the insert, which was silently
  // swallowed → the transmittal never persisted and the register stayed empty).
  const { error: transmittalErr } = await db.from('transmittals').insert({
    transmittal_number: transmittalNumber,
    batch_id:    batchId,
    vendor_id:   batch.vendor_id,
    package_id:  batch.package_id,
    final_outcome_code: overallCode,
    final_outcome_text: outcomeText(overallCode),
    generated_by: profile?.id ?? null,
    status: 'sent',
  })
  if (transmittalErr) console.error('Transmittal record insert failed:', transmittalErr.message)

  await db.from('batches').update({ status:'transmittal_generated', updated_at: new Date().toISOString() }).eq('id', batchId)
  await db.from('audit_events').insert({
    entity_type:'batch', entity_id:batchId, event_type:'transmittal_generated',
    actor_email: controllerEmail,
    event_data: { transmittalNumber, overallCode, toEmail, documentCount: documents.length },
  })

  await logActivity({ area: 'transmittals', action: 'transmittal.generate', targetType: 'batch', targetId: batchId, summary: `${transmittalNumber} → ${toEmail} (${overallCode})`, email: controllerEmail })
  return NextResponse.json({ success: true, transmittalNumber, transmittalDate, toEmail, transmittalData })
  } catch (e: any) {
    console.error('POST /generate-transmittal unhandled error:', e)
    return NextResponse.json({ error: `Server error: ${e?.message ?? String(e)}` }, { status: 500 })
  }
}
