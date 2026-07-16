import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import ExcelJS from 'exceljs'

// CDDL Excel export — reproduces the ORIGINAL workbook's look & feel exactly
// (measured from 6105AK124-0000-GDDR-0001 -Phase1 CDDL.xlsx, 2026-07-16):
// Aptos Narrow 10pt · header bold white on #00557E, wrapped, 24pt row · thin
// grid borders · everything centre-aligned · original column widths · frozen
// header · autofilter. Active docs on "CDDL", retired on "Docs not in Use".

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const HEADERS = [
  'Project Number', 'Package Number', 'Area/ WBS No.', 'Discipline', 'Document Type',
  'Sequential Number', 'Revision', 'RDMC Document Number', 'PPE Doc Number', 'Sht. # of #',
  'Area / Facility', 'Major Description', 'Broad Type', 'Full Title',
  'Rev A Transmittal Date', 'Rev 0 Transmittal Date', 'Aconex Doc Status', 'Aconex Review Status',
  '% Complete', 'Doc Owner', 'Comments', 'Due Date', 'Main Group', 'Sub Group',
  'BH', 'Drawing Pack', 'Activity ID', 'Schedule Status',
]
// original column widths, A..AB (P had no explicit width in the source = default)
const WIDTHS = [
  17.43, 18.43, 16.43, 13.29, 17.71, 20.57, 12.14, 25.29, 28.57, 12.71,
  48.71, 76.14, 63.57, 132.86, 22.71, 8.43, 21.86, 23.14, 15.0, 14.0,
  14.14, 23.29, 60.29, 65.14, 22.0, 29.43, 34.29, 13.0,
]

type Row = Record<string, string | number | boolean | null>

export async function GET() {
  // session gate — any signed-in CoreDocs user
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const svc = createServiceClient()
  const rows: Row[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await svc
      .from('cddl_doc')
      .select('*')
      .order('docno', { ascending: true })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Coreflow — CoreDocs CDDL Register'

  const FONT = { name: 'Aptos Narrow', size: 10 }
  const HDR_FONT = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }
  const HDR_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00557E' } }
  const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } }
  const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN }
  const CENTER: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true }
  const PCT_COL = HEADERS.indexOf('% Complete') + 1

  const s = (v: unknown) => (v == null ? '' : String(v))
  const toCells = (r: Row) => [
    '6105A', s(r.package_code), s(r.wbs), s(r.discipline), s(r.doc_type),
    s(r.seq_no), s(r.revision), s(r.docno), s(r.ppe_docno), s(r.sheet),
    s(r.area_facility), s(r.major_desc), s(r.broad_type), s(r.title),
    s(r.rev_a_transmittal), s(r.rev0_transmittal), s(r.aconex_doc_status), s(r.aconex_review_status),
    r.pct_complete == null ? 0 : Number(r.pct_complete), s(r.doc_owner_initials),
    s(r.comments), s(r.due), s(r.main_group), s(r.sub_group),
    s(r.bh), s(r.drawing_pack), s(r.activity_id), s(r.schedule_status),
  ]

  const buildSheet = (name: string, data: Row[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w })
    const hr = ws.addRow(HEADERS)
    hr.height = 24
    hr.eachCell(c => { c.font = HDR_FONT; c.fill = HDR_FILL; c.border = BORDER; c.alignment = CENTER })
    for (const r of data) {
      const row = ws.addRow(toCells(r))
      row.eachCell({ includeEmpty: true }, c => { c.font = FONT; c.border = BORDER; c.alignment = CENTER })
      row.getCell(PCT_COL).numFmt = '0%'
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } }
  }

  buildSheet('CDDL', rows.filter(r => !r.retired))
  const retired = rows.filter(r => r.retired)
  if (retired.length) buildSheet('Docs not in Use', retired)

  const buf = await wb.xlsx.writeBuffer()
  const today = new Date().toISOString().slice(0, 10)
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="6105AK124-0000-GDDR-0001 - Phase1 CDDL (Coreflow ${today}).xlsx"`,
    },
  })
}
