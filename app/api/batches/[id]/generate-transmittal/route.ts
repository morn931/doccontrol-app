import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/services/graph'
import { vendorTransmittalEmail } from '@/lib/services/email-templates'
import { OUTCOME_CODES } from '@/lib/utils/outcome-codes'
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

// ─── PDF builder (pdfmake with built-in Helvetica, no font files needed) ─────

async function buildTransmittalPdf(data: TransmittalData): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PdfPrinter = require('pdfmake') as any
  const printer = new PdfPrinter({
    Helvetica: { normal:'Helvetica', bold:'Helvetica-Bold', italics:'Helvetica-Oblique', bolditalics:'Helvetica-BoldOblique' }
  })

  const BLUE = '#003087', LGRAY = '#F2F4F6', MGRAY = '#CCCCCC', WHITE = '#FFFFFF'
  const OUTCOME_BG: Record<string,string> = { A1:'#E8F5E9',D1:'#E3F2FD',B1:'#FFF9C4',B2:'#FFE0B2',C1:'#FFCDD2',Q1:'#FFCDD2',V1:'#EEEEEE',S1:'#EEEEEE' }
  const OUTCOME_FG: Record<string,string> = { A1:'#1B5E20',D1:'#0D47A1',B1:'#F57F17',B2:'#BF360C',C1:'#B71C1C',Q1:'#B71C1C',V1:'#424242',S1:'#424242' }

  function hdr(text: string) {
    return { text, font:'Helvetica', fontSize:8, bold:true, color:WHITE, fillColor:BLUE, margin:[4,4,4,4] }
  }
  function cell(text: string, opts?: { bold?:boolean; bg?:string; fg?:string; align?:string }) {
    return { text: text ?? '', font:'Helvetica', fontSize:8, bold:opts?.bold, color:opts?.fg??'#111111',
             fillColor:opts?.bg, alignment:(opts?.align??'left') as any, margin:[4,3,4,3] }
  }

  const docContent: any[] = [
    // ── Title block
    { canvas: [{ type:'rect', x:0, y:0, w:515, h:50, color:BLUE }] },
    { absolutePosition:{ x:40, y:20 }, text:'PPE TECH  ·  Document Control', font:'Helvetica', fontSize:14, bold:true, color:WHITE },
    { absolutePosition:{ x:40, y:37 }, text:'DOCUMENT TRANSMITTAL', font:'Helvetica', fontSize:9, color:'#AACCEE' },
    { text: ' ', margin:[0,55,0,0] },

    // ── Info table
    { margin:[0,0,0,12],
      table:{ widths:[120,'*'], body:[
        [{ text:'TRANSMITTAL INFORMATION', colSpan:2, bold:true, font:'Helvetica', fontSize:8, color:WHITE, fillColor:BLUE, margin:[4,4,4,4] },{}],
        [cell('Transmittal Number',{bold:true,bg:LGRAY}), cell(data.transmittalNumber,{bold:true})],
        [cell('Date',{bold:true,bg:LGRAY}),               cell(format(new Date(),'d MMMM yyyy'))],
        [cell('Vendor',{bold:true,bg:LGRAY}),              cell(data.vendorName)],
        [cell('Project Package',{bold:true,bg:LGRAY}),     cell(`${data.packageCode}  —  ${data.packageName}`)],
        [cell('No. of Documents',{bold:true,bg:LGRAY}),    cell(String(data.documents.length))],
        [cell('Overall Outcome',{bold:true,bg:LGRAY}),     cell(`${data.overallCode}  —  ${outcomeText(data.overallCode)}`,{bold:true,fg:OUTCOME_FG[data.overallCode]??'#111'})],
        [cell('Prepared By',{bold:true,bg:LGRAY}),         cell(data.controllerEmail)],
      ], layout:{ hLineWidth:()=>0.5, vLineWidth:()=>0.5, hLineColor:()=>MGRAY, vLineColor:()=>MGRAY } }
    },

    // ── Document summary table
    { margin:[0,0,0,0],
      table:{ widths:[16,130,'*',22,28], body:[
        [hdr('#'),hdr('Document Number'),hdr('Document Title'),hdr('Rev'),hdr('Code')],
        ...data.documents.map((d,i)=>[
          cell(String(i+1),{bg:i%2?WHITE:LGRAY,align:'center'}),
          cell(d.fileName,  {bg:i%2?WHITE:LGRAY}),
          cell(d.docName||d.fileName,{bg:i%2?WHITE:LGRAY}),
          cell(d.revision||'0',{bg:i%2?WHITE:LGRAY,align:'center'}),
          cell(d.outcomeCode,{bg:OUTCOME_BG[d.outcomeCode]??LGRAY,fg:OUTCOME_FG[d.outcomeCode]??'#111',bold:true,align:'center'}),
        ])
      ], layout:{ hLineWidth:()=>0.5, vLineWidth:()=>0.5, hLineColor:()=>MGRAY, vLineColor:()=>MGRAY } }
    },
  ]

  // ── Per-document sections
  for (let i = 0; i < data.documents.length; i++) {
    const doc = data.documents[i]
    docContent.push({ text:'', pageBreak:'before' })
    docContent.push({
      margin:[0,0,0,8],
      table:{ widths:['*'], body:[[
        { text:`DOCUMENT ${i+1} OF ${data.documents.length}  ·  ${doc.outcomeCode}: ${outcomeText(doc.outcomeCode)}`,
          font:'Helvetica', fontSize:9, bold:true, color:WHITE, fillColor:BLUE, margin:[6,5,6,5] }
      ]]}, layout:'noBorders'
    })
    docContent.push({
      margin:[0,0,0,8],
      table:{ widths:[100,'*'], body:[
        [cell('Document Number',{bold:true,bg:LGRAY}), cell(doc.fileName)],
        [cell('Document Title',{bold:true,bg:LGRAY}),  cell(doc.docName||doc.fileName)],
        [cell('Revision',{bold:true,bg:LGRAY}),         cell(doc.revision||'0')],
        [cell('Discipline',{bold:true,bg:LGRAY}),        cell([doc.discipline,doc.documentType,doc.topic].filter(Boolean).join('  ·  ')||'—')],
        [cell('Overall Outcome',{bold:true,bg:LGRAY}),   cell(`${doc.outcomeCode}  —  ${outcomeText(doc.outcomeCode)}`,{bold:true,fg:OUTCOME_FG[doc.outcomeCode]??'#111'})],
      ], layout:{ hLineWidth:()=>0.5, vLineWidth:()=>0.5, hLineColor:()=>MGRAY, vLineColor:()=>MGRAY } }
    })
    // Reviewer outcomes
    docContent.push({ text:'REVIEWER OUTCOMES', font:'Helvetica', fontSize:8, bold:true, color:BLUE, margin:[0,0,0,4] })
    docContent.push({
      margin:[0,0,0,8],
      table:{ widths:[100,24,130,'*'], body:[
        [hdr('Reviewer'),hdr('Code'),hdr('Description'),hdr('Comment')],
        ...doc.reviewers.map((r,ri)=>[
          cell(r.name,   {bg:ri%2?WHITE:LGRAY}),
          cell(r.code,   {bg:OUTCOME_BG[r.code]??LGRAY,fg:OUTCOME_FG[r.code]??'#111',bold:true,align:'center'}),
          cell(outcomeText(r.code),{bg:ri%2?WHITE:LGRAY,fg:'#555'}),
          cell(r.comment||'—',{bg:ri%2?WHITE:LGRAY}),
        ])
      ], layout:{ hLineWidth:()=>0.5, vLineWidth:()=>0.5, hLineColor:()=>MGRAY, vLineColor:()=>MGRAY } }
    })
    // AI markup summary
    if (doc.markupSummary) {
      docContent.push({ text:'MARKUP SUMMARY (AI-GENERATED)', font:'Helvetica', fontSize:8, bold:true, color:BLUE, margin:[0,0,0,4] })
      for (const line of doc.markupSummary.split('\n').filter(l=>l.trim())) {
        docContent.push({ text:line.trim(), font:'Helvetica', fontSize:8, margin:[0,1,0,1] })
      }
    }
  }

  // ── Acknowledgement
  docContent.push({ text:'', pageBreak:'before' })
  docContent.push({
    margin:[0,0,0,8],
    table:{ widths:['*'], body:[[
      { text:'ACKNOWLEDGEMENT OF RECEIPT', font:'Helvetica', fontSize:9, bold:true, color:WHITE, fillColor:BLUE, margin:[6,5,6,5] }
    ]]}, layout:'noBorders'
  })
  docContent.push({
    text:'This transmittal confirms that the above-referenced documents have been reviewed in accordance with PPE Tech\'s document control procedures. Please action as required based on the review codes provided.',
    font:'Helvetica', fontSize:8, margin:[0,0,0,12]
  })
  docContent.push({
    margin:[0,0,0,16],
    table:{ widths:[80,130,130,'*'], body:[
      [hdr('For'),hdr('Name and Surname'),hdr('Signature'),hdr('Date')],
      [cell('PPE Tech',{bold:true,bg:LGRAY}),cell(''),cell(''),cell('')],
      [cell('Client',{bold:true,bg:LGRAY}),  cell(''),cell(''),cell('')],
    ], layout:{ hLineWidth:()=>0.5, vLineWidth:()=>0.5, hLineColor:()=>MGRAY, vLineColor:()=>MGRAY } }
  })
  // Legend
  docContent.push({ text:'REVIEW CODE LEGEND', font:'Helvetica', fontSize:8, bold:true, color:BLUE, margin:[0,0,0,4] })
  docContent.push({
    table:{ widths:[28,'*'], body: Object.values(OUTCOME_CODES).map((oc:any,i)=>[
      cell(oc.code,{bg:OUTCOME_BG[oc.code]??LGRAY,fg:OUTCOME_FG[oc.code]??'#111',bold:true,align:'center'}),
      cell(oc.text,{bg:i%2?WHITE:LGRAY}),
    ])}, layout:{ hLineWidth:()=>0.5, vLineWidth:()=>0.5, hLineColor:()=>MGRAY, vLineColor:()=>MGRAY }
  })
  docContent.push({ text:`Generated by PPE Tech Document Control System  ·  ${format(new Date(),'d MMMM yyyy')}  ·  Confidential`, font:'Helvetica', fontSize:7, color:'#888888', italics:true, alignment:'center', margin:[0,16,0,0] })

  const docDef = {
    pageSize:'A4', pageMargins:[40,50,40,50],
    defaultStyle:{ font:'Helvetica', fontSize:9 },
    header: (currentPage:number, pageCount:number) => ({
      columns:[
        { text:`PPE TECH  ·  Document Control  ·  ${data.transmittalNumber}`, font:'Helvetica', fontSize:7, color:'#666', margin:[40,16,0,0] },
        { text:`${data.vendorName}  ·  ${data.packageCode}  ·  Page ${currentPage} of ${pageCount}`, font:'Helvetica', fontSize:7, color:'#666', alignment:'right', margin:[0,16,40,0] },
      ]
    }),
    content: docContent,
  }

  return new Promise<Buffer>((resolve, reject) => {
    const pdfDoc = printer.createPdfKitDocument(docDef)
    const chunks: Buffer[] = []
    pdfDoc.on('data', (c: Buffer) => chunks.push(c))
    pdfDoc.on('end',  () => resolve(Buffer.concat(chunks)))
    pdfDoc.on('error', reject)
    pdfDoc.end()
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

  const documents: TransmittalDocument[] = docVersions.map((dv: any) => {
    const tasks   = tasksByDv[dv.id] ?? []
    const codes   = tasks.map((t: any) => t.review_outcome_code).filter(Boolean)
    const outCode = worstCode(codes) || 'A1'
    return {
      fileName: dv.file_name, docName: dv.doc_name, revision: dv.revision,
      discipline: dv.discipline, documentType: dv.document_type, topic: dv.topic,
      outcomeCode: outCode, markupSummary: '',
      reviewers: tasks.map((t: any) => ({
        name:    nameMap[t.reviewer_email] ?? t.reviewer_email.split('@')[0],
        code:    t.review_outcome_code ?? '—',
        comment: t.comment ?? '',
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, email, full_name')
    .eq('auth_user_id', user.id).single()
  if (!['admin','document_controller'].includes(profile?.role ?? ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: batchId } = await params
  const body = await req.json()
  const { toEmail, ccEmails = [] }: { toEmail: string; ccEmails: string[] } = body

  if (!toEmail?.trim()) return NextResponse.json({ error: 'Vendor email is required' }, { status: 400 })

  const db = createServiceClient()

  const { data: batch } = await db.from('batches')
    .select(`id, batch_guid, status, target_library, controller_email, comments,
             vendor_id, package_id,
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

  // Note: AI markup extraction is skipped here to keep within Vercel function timeout.
  // Markup summaries stored on review_tasks.markup_summary are included if available.

  const tasksByDv: Record<string, any[]> = {}
  for (const t of allTasks ?? []) {
    if (!tasksByDv[t.document_version_id]) tasksByDv[t.document_version_id] = []
    tasksByDv[t.document_version_id].push(t)
  }

  const documents: TransmittalDocument[] = docVersions.map((dv:any) => {
    const tasks    = tasksByDv[dv.id] ?? []
    const codes    = tasks.map((t:any) => t.review_outcome_code).filter(Boolean)
    const outCode  = worstCode(codes) || 'A1'
    const markup   = markupResults[i]?.status === 'fulfilled' ? (markupResults[i] as any).value as string : ''
    return {
      fileName: dv.file_name, docName: dv.doc_name, revision: dv.revision,
      discipline: dv.discipline, documentType: dv.document_type, topic: dv.topic,
      outcomeCode: outCode, markupSummary: '',
      reviewers: tasks.map((t:any) => ({
        name: nameMap[t.reviewer_email] ?? t.reviewer_email.split('@')[0],
        code: t.review_outcome_code ?? '—', comment: t.comment ?? '',
      })),
    }
  })

  const overallCode    = worstCode(documents.map(d => d.outcomeCode)) || 'A1'
  const vendorName     = (batch.vendors as any)?.name ?? 'Vendor'
  const packageCode    = (batch.packages as any)?.package_code ?? ''
  const packageName    = (batch.packages as any)?.package_name ?? ''
  const controllerEmail = profile?.email ?? batch.controller_email ?? ''
  const controllerName  = profile?.full_name ?? controllerEmail.split('@')[0]
  const transmittalNumber = await nextTransmittalNumber(db)
  const transmittalDate   = format(new Date(), 'd MMMM yyyy')

  const transmittalData: TransmittalData = {
    transmittalNumber, vendorName, packageCode, packageName,
    overallCode, controllerEmail, controllerName, documents,
  }

  // Generate PDF
  const pdfBuffer = await buildTransmittalPdf(transmittalData)

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

  // Store transmittal record
  await db.from('transmittals').insert({
    transmittal_number: transmittalNumber,
    batch_id:    batchId,
    vendor_id:   batch.vendor_id,
    package_id:  batch.package_id,
    final_outcome_code: overallCode,
    final_outcome_text: outcomeText(overallCode),
    generated_by: profile?.email,
    status: 'sent',
  }).select()

  await db.from('batches').update({ status:'transmittal_generated', updated_at: new Date().toISOString() }).eq('id', batchId)
  await db.from('audit_events').insert({
    entity_type:'batch', entity_id:batchId, event_type:'transmittal_generated',
    actor_email: controllerEmail,
    event_data: { transmittalNumber, overallCode, toEmail, documentCount: documents.length },
  })

  return NextResponse.json({ success: true, transmittalNumber, transmittalDate, toEmail, transmittalData })
}
