import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getMarkupSummary } from '@/lib/services/markup-extractor'
import { OUTCOME_CODES } from '@/lib/utils/outcome-codes'
import { format } from 'date-fns'

// ─── Outcome code helpers ─────────────────────────────────────────────────────

const SEVERITY: Record<string, number> = { A1:1,D1:2,B1:3,B2:4,C1:5,Q1:6,V1:7,S1:8 }

function worstCode(codes: string[]): string {
  return codes.filter(Boolean).sort((a,b) => (SEVERITY[b]??0)-(SEVERITY[a]??0))[0] ?? 'A1'
}

function outcomeText(code: string): string {
  return (OUTCOME_CODES as any)[code]?.text ?? code
}

// ─── Transmittal number generator ────────────────────────────────────────────

async function nextTransmittalNumber(db: any): Promise<string> {
  const year = new Date().getFullYear()
  // Increment the sequence atomically via RPC or manual update
  const { data: seq } = await db
    .from('transmittal_sequences')
    .select('last_seq')
    .eq('year', year)
    .single()

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

// ─── DOCX builder ─────────────────────────────────────────────────────────────

async function buildTransmittalDocx(data: TransmittalData): Promise<Buffer> {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
    ShadingType, VerticalAlign, PageBreak, PageNumber,
  } = await import('docx')

  const BLUE     = '003087'   // PPE Tech dark blue
  const LIGHTBLUE = 'D6E4F0'
  const GRAY     = 'F2F4F6'
  const MIDGRAY  = 'CCCCCC'
  const WHITE    = 'FFFFFF'
  const NONE     = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const THIN     = { style: BorderStyle.SINGLE, size: 1, color: MIDGRAY }
  const THICK    = { style: BorderStyle.SINGLE, size: 4, color: BLUE }

  function cell(text: string, opts: {
    bold?: boolean; color?: string; fill?: string; w: number; borders?: any; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; vAlign?: (typeof VerticalAlign)[keyof typeof VerticalAlign]; span?: number
  }) {
    return new TableCell({
      columnSpan: opts.span,
      width: { size: opts.w, type: WidthType.DXA },
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
      verticalAlign: opts.vAlign ?? VerticalAlign.CENTER,
      borders: opts.borders ?? { top: THIN, bottom: THIN, left: THIN, right: THIN },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? '000000', font: 'Arial', size: 18 })]
      })]
    })
  }

  function heading(text: string) {
    return new Paragraph({
      spacing: { before: 240, after: 80 },
      children: [
        new TextRun({ text, bold: true, font: 'Arial', size: 20, color: WHITE }),
      ],
      shading: { fill: BLUE, type: ShadingType.CLEAR },
      indent: { left: 120, right: 120 },
    })
  }

  function label(text: string) {
    return new TextRun({ text, font: 'Arial', size: 18, color: '555555' })
  }

  function value(text: string, bold = false) {
    return new TextRun({ text, font: 'Arial', size: 18, bold, color: '111111' })
  }

  function spacer() {
    return new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun('')] })
  }

  // ── Outcome badge colour (used in summary table shading) ────────────────────
  const OUTCOME_FILL: Record<string, string> = {
    A1:'E8F5E9', D1:'E3F2FD', B1:'FFF9C4', B2:'FFE0B2', C1:'FFCDD2', Q1:'FFCDD2', V1:'EEEEEE', S1:'EEEEEE'
  }
  const OUTCOME_BORDER_COLOR: Record<string, string> = {
    A1:'388E3C', D1:'1976D2', B1:'F9A825', B2:'E65100', C1:'C62828', Q1:'C62828', V1:'757575', S1:'757575'
  }

  // ─── 1. Title block ─────────────────────────────────────────────────────────
  const titleBlock = [
    new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [6000, 3026],
      borders: { top: THICK, bottom: THICK, left: THICK, right: THICK, insideH: NONE, insideV: NONE },
      rows: [new TableRow({ children: [
        new TableCell({
          width: { size: 6000, type: WidthType.DXA },
          shading: { fill: BLUE, type: ShadingType.CLEAR },
          borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
          margins: { top: 200, bottom: 200, left: 200, right: 200 },
          children: [
            new Paragraph({ children: [new TextRun({ text: 'PPE TECH', bold: true, font: 'Arial', size: 32, color: WHITE })] }),
            new Paragraph({ children: [new TextRun({ text: 'Document Control System', font: 'Arial', size: 18, color: 'AACCEE' })] }),
          ]
        }),
        new TableCell({
          width: { size: 3026, type: WidthType.DXA },
          shading: { fill: BLUE, type: ShadingType.CLEAR },
          borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 200, bottom: 200, left: 200, right: 200 },
          children: [
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'DOCUMENT TRANSMITTAL', bold: true, font: 'Arial', size: 22, color: WHITE })] }),
          ]
        }),
      ]})]
    }),
    spacer(),
  ]

  // ─── 2. Transmittal info table ───────────────────────────────────────────────
  const infoRows = [
    ['Transmittal Number', data.transmittalNumber],
    ['Date',              format(new Date(), 'd MMMM yyyy')],
    ['Vendor',            data.vendorName],
    ['Project Package',   `${data.packageCode} — ${data.packageName}`],
    ['Number of Documents', String(data.documents.length)],
    ['Overall Review Outcome', `${data.overallCode} — ${outcomeText(data.overallCode)}`],
    ['Prepared By',       data.controllerEmail],
  ]
  const infoTable = new Table({
    width: { size: 9026, type: WidthType.DXA },
    columnWidths: [2800, 6226],
    rows: infoRows.map(([lbl, val], i) => new TableRow({ children: [
      cell(lbl, { w: 2800, fill: i % 2 === 0 ? LIGHTBLUE : WHITE, bold: true }),
      cell(val, { w: 6226, fill: i % 2 === 0 ? GRAY : WHITE }),
    ]}))
  })

  // ─── 3. Document summary table ───────────────────────────────────────────────
  const summaryHeaderRow = new TableRow({ children: [
    cell('#',               { w: 400,  fill: BLUE, bold: true, color: WHITE, align: AlignmentType.CENTER }),
    cell('Document Number', { w: 3200, fill: BLUE, bold: true, color: WHITE }),
    cell('Document Title',  { w: 3226, fill: BLUE, bold: true, color: WHITE }),
    cell('Rev', { w: 500,  fill: BLUE, bold: true, color: WHITE, align: AlignmentType.CENTER }),
    cell('Code',{ w: 700,  fill: BLUE, bold: true, color: WHITE, align: AlignmentType.CENTER }),
  ]})

  const summaryRows = data.documents.map((doc, i) => new TableRow({ children: [
    cell(String(i+1),             { w: 400,  align: AlignmentType.CENTER, fill: i%2===0?GRAY:WHITE }),
    cell(doc.fileName,            { w: 3200, fill: i%2===0?GRAY:WHITE }),
    cell(doc.docName||doc.fileName, { w: 3226, fill: i%2===0?GRAY:WHITE }),
    cell(doc.revision||'0',       { w: 500,  align: AlignmentType.CENTER, fill: i%2===0?GRAY:WHITE }),
    cell(doc.outcomeCode,         { w: 700,  align: AlignmentType.CENTER, fill: OUTCOME_FILL[doc.outcomeCode]||GRAY, bold: true }),
  ]}))

  const summaryTable = new Table({
    width: { size: 9026, type: WidthType.DXA },
    columnWidths: [400, 3200, 3226, 500, 700],
    rows: [summaryHeaderRow, ...summaryRows]
  })

  // ─── 4. Per-document detail sections ─────────────────────────────────────────
  const docSections: any[] = []

  for (let i = 0; i < data.documents.length; i++) {
    const doc = data.documents[i]
    if (i > 0) docSections.push(new Paragraph({ children: [new PageBreak()] }))

    docSections.push(heading(`DOCUMENT ${i+1} OF ${data.documents.length}  —  ${doc.outcomeCode}: ${outcomeText(doc.outcomeCode)}`))
    docSections.push(spacer())

    // Doc metadata table
    const metaRows = [
      ['Document Number', doc.fileName],
      ['Document Title',  doc.docName || doc.fileName],
      ['Revision',        doc.revision || '0'],
      ['Discipline',      [doc.discipline, doc.documentType, doc.topic].filter(Boolean).join('  ·  ') || '—'],
      ['Overall Outcome', `${doc.outcomeCode} — ${outcomeText(doc.outcomeCode)}`],
    ]
    docSections.push(new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [2200, 6826],
      rows: metaRows.map(([lbl, val]) => new TableRow({ children: [
        cell(lbl, { w: 2200, fill: LIGHTBLUE, bold: true }),
        cell(val, { w: 6826 }),
      ]}))
    }))
    docSections.push(spacer())

    // Reviewer outcomes table
    docSections.push(new Paragraph({
      spacing: { before: 120, after: 80 },
      children: [new TextRun({ text: 'REVIEWER OUTCOMES', bold: true, font: 'Arial', size: 18, color: BLUE })]
    }))

    const reviewHeaderRow = new TableRow({ children: [
      cell('Reviewer',    { w: 2200, fill: BLUE, bold: true, color: WHITE }),
      cell('Code',        { w: 600,  fill: BLUE, bold: true, color: WHITE, align: AlignmentType.CENTER }),
      cell('Description', { w: 2800, fill: BLUE, bold: true, color: WHITE }),
      cell('Comment',     { w: 3426, fill: BLUE, bold: true, color: WHITE }),
    ]})

    const reviewRows = doc.reviewers.map((r, ri) => new TableRow({ children: [
      cell(r.name,              { w: 2200, fill: ri%2===0?GRAY:WHITE }),
      cell(r.code,              { w: 600,  fill: OUTCOME_FILL[r.code]||GRAY, bold: true, align: AlignmentType.CENTER }),
      cell(outcomeText(r.code), { w: 2800, fill: ri%2===0?GRAY:WHITE }),
      cell(r.comment||'—',      { w: 3426, fill: ri%2===0?GRAY:WHITE }),
    ]}))

    docSections.push(new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [2200, 600, 2800, 3426],
      rows: [reviewHeaderRow, ...reviewRows]
    }))
    docSections.push(spacer())

    // AI markup summary
    if (doc.markupSummary) {
      docSections.push(new Paragraph({
        spacing: { before: 120, after: 80 },
        children: [new TextRun({ text: 'MARKUP SUMMARY (AI-GENERATED)', bold: true, font: 'Arial', size: 18, color: BLUE })]
      }))
      const summaryLines = doc.markupSummary.split('\n').filter(l => l.trim())
      for (const line of summaryLines) {
        docSections.push(new Paragraph({
          spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: line.trim(), font: 'Arial', size: 18 })]
        }))
      }
    }
  }

  // ─── 5. Acknowledgement + legend ─────────────────────────────────────────────
  const ackSection = [
    new Paragraph({ children: [new PageBreak()] }),
    heading('ACKNOWLEDGEMENT OF RECEIPT'),
    spacer(),
    new Paragraph({
      spacing: { before: 0, after: 160 },
      children: [new TextRun({ text: 'This transmittal confirms that the above-referenced documents have been reviewed in accordance with PPE Tech\'s document control procedures. Review outcomes are as indicated. Please action as required based on the review codes provided.', font: 'Arial', size: 18 })]
    }),
    new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [1800, 3000, 2226, 2000],
      rows: [
        new TableRow({ children: [
          cell('For',               { w: 1800, fill: BLUE, bold: true, color: WHITE }),
          cell('Name and Surname',  { w: 3000, fill: BLUE, bold: true, color: WHITE }),
          cell('Signature',         { w: 2226, fill: BLUE, bold: true, color: WHITE }),
          cell('Date',              { w: 2000, fill: BLUE, bold: true, color: WHITE }),
        ]}),
        new TableRow({ children: [
          cell('PPE Tech', { w: 1800, fill: LIGHTBLUE, bold: true }),
          cell('',         { w: 3000 }),
          cell('',         { w: 2226 }),
          cell('',         { w: 2000 }),
        ]}),
        new TableRow({ children: [
          cell('Client',   { w: 1800, fill: LIGHTBLUE, bold: true }),
          cell('',         { w: 3000 }),
          cell('',         { w: 2226 }),
          cell('',         { w: 2000 }),
        ]}),
      ]
    }),
    spacer(),
    heading('REVIEW CODE LEGEND'),
    spacer(),
    new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [700, 8326],
      rows: Object.values(OUTCOME_CODES).map((oc: any, i) => new TableRow({ children: [
        cell(oc.code, { w: 700,  fill: OUTCOME_FILL[oc.code]||GRAY, bold: true, align: AlignmentType.CENTER }),
        cell(oc.text, { w: 8326, fill: i%2===0?GRAY:WHITE }),
      ]}))
    }),
    spacer(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240 },
      children: [new TextRun({ text: `Generated by PPE Tech Document Control System  ·  ${format(new Date(), 'd MMMM yyyy')}  ·  Confidential`, font: 'Arial', size: 16, color: '888888', italics: true })]
    }),
  ]

  // ─── Assemble document ────────────────────────────────────────────────────────
  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 18 } } }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1000, right: 900, bottom: 1000, left: 900 }
        }
      },
      headers: {
        default: new Header({ children: [
          new Table({
            width: { size: 10106, type: WidthType.DXA },
            columnWidths: [5053, 5053],
            borders: { top: NONE, bottom: { style: BorderStyle.SINGLE, size: 4, color: BLUE }, left: NONE, right: NONE, insideH: NONE, insideV: NONE },
            rows: [new TableRow({ children: [
              new TableCell({ width: { size: 5053, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: [new Paragraph({ children: [new TextRun({ text: `PPE TECH  ·  Document Control  ·  ${data.transmittalNumber}`, font: 'Arial', size: 16, color: '555555' })] })] }),
              new TableCell({ width: { size: 5053, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${data.vendorName}  ·  ${data.packageCode}`, font: 'Arial', size: 16, color: '555555' })] })] }),
            ]})]
          })
        ]})
      },
      children: [
        ...titleBlock,
        spacer(),
        new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: 'TRANSMITTAL INFORMATION', bold: true, font: 'Arial', size: 18, color: BLUE })] }),
        infoTable,
        spacer(),
        new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: 'DOCUMENT SUMMARY', bold: true, font: 'Arial', size: 18, color: BLUE })] }),
        summaryTable,
        ...docSections,
        ...ackSection,
      ]
    }]
  })

  return await Packer.toBuffer(doc) as unknown as Buffer
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransmittalDocument {
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

interface TransmittalData {
  transmittalNumber: string
  vendorName:        string
  packageCode:       string
  packageName:       string
  overallCode:       string
  controllerEmail:   string
  documents:         TransmittalDocument[]
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, email, full_name')
    .eq('auth_user_id', user.id).single()
  if (!['admin','document_controller'].includes(profile?.role ?? ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: batchId } = await params
  const db = createServiceClient()

  // ── Fetch batch + documents ────────────────────────────────────────────────
  const { data: batch } = await db.from('batches')
    .select(`id, batch_guid, status, target_library, controller_email, comments,
             vendor_id, package_id,
             vendors(name), packages(package_name, package_code),
             document_versions(id, file_name, doc_name, doc_unique_id, central_file_url,
                               revision, discipline, document_type, topic)`)
    .eq('id', batchId).single()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (!['review_complete','transmittal_generated'].includes(batch.status))
    return NextResponse.json({ error: 'Batch is not ready for transmittal' }, { status: 400 })

  const docVersions = (batch.document_versions as any[]) ?? []

  // ── Fetch all review tasks for this batch ─────────────────────────────────
  const { data: allTasks } = await db.from('review_tasks')
    .select('document_version_id, reviewer_email, review_outcome_code, comment, sequence_number, status')
    .eq('batch_id', batchId)
    .eq('status', 'completed')
    .order('sequence_number', { ascending: true })

  // Fetch reviewer display names
  const reviewerEmails = [...new Set((allTasks ?? []).map((t: any) => t.reviewer_email as string))]
  const { data: reviewerUsers } = await db.from('users').select('email, full_name').in('email', reviewerEmails)
  const nameMap: Record<string, string> = {}
  for (const u of reviewerUsers ?? []) { if (u.email) nameMap[u.email] = u.full_name ?? u.email.split('@')[0] }

  function displayName(email: string) { return nameMap[email] ?? email.split('@')[0] }

  // ── Run markup extraction in parallel ─────────────────────────────────────
  const markupResults = await Promise.allSettled(
    docVersions.map((dv: any) =>
      Promise.race([
        getMarkupSummary({
          centralFileUrl: dv.central_file_url,
          fileName:       dv.file_name,
          docName:        dv.doc_name,
          docUniqueId:    dv.doc_unique_id,
          libraryName:    (batch as any).target_library,
        }),
        new Promise<string>(resolve => setTimeout(() => resolve(''), 25_000)), // 25s timeout
      ])
    )
  )

  // ── Build transmittal data ─────────────────────────────────────────────────
  const tasksByDv: Record<string, any[]> = {}
  for (const t of allTasks ?? []) {
    if (!tasksByDv[t.document_version_id]) tasksByDv[t.document_version_id] = []
    tasksByDv[t.document_version_id].push(t)
  }

  const documents: TransmittalDocument[] = docVersions.map((dv: any, i: number) => {
    const tasks  = tasksByDv[dv.id] ?? []
    const codes  = tasks.map((t: any) => t.review_outcome_code).filter(Boolean)
    const outCode = worstCode(codes) || 'A1'
    const markupSummary = markupResults[i]?.status === 'fulfilled' ? (markupResults[i] as any).value as string : ''

    return {
      fileName:      dv.file_name,
      docName:       dv.doc_name,
      revision:      dv.revision,
      discipline:    dv.discipline,
      documentType:  dv.document_type,
      topic:         dv.topic,
      outcomeCode:   outCode,
      markupSummary,
      reviewers: tasks.map((t: any) => ({
        name:    displayName(t.reviewer_email),
        code:    t.review_outcome_code ?? '—',
        comment: t.comment ?? '',
      })),
    }
  })

  const allCodes   = documents.map(d => d.outcomeCode)
  const overallCode = worstCode(allCodes) || 'A1'
  const vendorName  = (batch.vendors as any)?.name ?? 'Unknown Vendor'
  const packageCode = (batch.packages as any)?.package_code ?? ''
  const packageName = (batch.packages as any)?.package_name ?? ''

  // ── Generate transmittal number ───────────────────────────────────────────
  const transmittalNumber = await nextTransmittalNumber(db)

  const transmittalData: TransmittalData = {
    transmittalNumber,
    vendorName,
    packageCode,
    packageName,
    overallCode,
    controllerEmail: profile?.email ?? batch.controller_email ?? '',
    documents,
  }

  // ── Build docx ────────────────────────────────────────────────────────────
  let docxBuffer: Buffer
  try {
    docxBuffer = await buildTransmittalDocx(transmittalData)
  } catch (e: any) {
    console.error('DOCX generation failed:', e.message)
    return NextResponse.json({ error: 'Failed to generate document: ' + e.message }, { status: 500 })
  }

  // ── Store transmittal record ──────────────────────────────────────────────
  await db.from('transmittals').insert({
    transmittal_number: transmittalNumber,
    batch_id:           batchId,
    vendor_id:          batch.vendor_id,
    package_id:         batch.package_id,
    final_outcome_code: overallCode,
    final_outcome_text: outcomeText(overallCode),
    generated_by:       profile?.email,
    status:             'draft',
  })

  await db.from('batches').update({ status: 'transmittal_generated', updated_at: new Date().toISOString() }).eq('id', batchId)

  await db.from('audit_events').insert({
    entity_type: 'batch', entity_id: batchId,
    event_type:  'transmittal_generated',
    actor_email: profile?.email,
    event_data:  { transmittalNumber, overallCode, documentCount: documents.length },
  })

  // ── Stream docx to client ─────────────────────────────────────────────────
  const fileName = `${transmittalNumber}.docx`
  return new Response(docxBuffer, {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length':      String(docxBuffer.length),
    }
  })
}
