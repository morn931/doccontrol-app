import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import ExcelJS from 'exceljs'

// CDDL Excel export — reproduces each ORIGINAL workbook's look & feel exactly.
//
// K124 (Phase 1, measured 2026-07-16): Aptos Narrow 10pt · header bold white on
// #00557E, wrapped, 24pt row · thin grid borders · everything centre-aligned ·
// original column widths · frozen header · autofilter. Retired docs on a
// "Docs not in Use" sheet.
//
// K038 (Early Works, measured 2026-07-17): an Excel TABLE (TableStyleMedium2,
// banded row stripes + filter buttons) · Aptos Narrow 10pt · header bold white
// on #595959 (Black Text-1 lighter 35%), 26.25pt row · NO cell borders ·
// centre-aligned · original widths. Cols I..P are the formula-derived pieces
// of the PPE doc number — reconstructed here from ppe_docno. Retired docs on
// the workbook's own "Docs not in use" sheet.

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Row = Record<string, string | number | boolean | null>
const s = (v: unknown) => (v == null ? '' : String(v))

const FONT = { name: 'Aptos Narrow', size: 10 }
const HDR_FONT = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }
const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } }
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN }

// ---------------------------------------------------------------- Phase 1 ---
const K124_HEADERS = [
  'Project Number', 'Package Number', 'Area/ WBS No.', 'Discipline', 'Document Type',
  'Sequential Number', 'Revision', 'RDMC Document Number', 'PPE Doc Number', 'Sht. # of #',
  'Area / Facility', 'Major Description', 'Broad Type', 'Full Title',
  'Rev A Transmittal Date', 'Rev 0 Transmittal Date', 'Aconex Doc Status', 'Aconex Review Status',
  '% Complete', 'Doc Owner', 'Comments', 'Due Date', 'Main Group', 'Sub Group',
  'BH', 'Drawing Pack', 'Activity ID', 'Schedule Status',
]
// original column widths, A..AB (P had no explicit width in the source = default)
const K124_WIDTHS = [
  17.43, 18.43, 16.43, 13.29, 17.71, 20.57, 12.14, 25.29, 28.57, 12.71,
  48.71, 76.14, 63.57, 132.86, 22.71, 8.43, 21.86, 23.14, 15.0, 14.0,
  14.14, 23.29, 60.29, 65.14, 22.0, 29.43, 34.29, 13.0,
]
const k124Cells = (r: Row) => [
  '6105A', s(r.package_code), s(r.wbs), s(r.discipline), s(r.doc_type),
  s(r.seq_no), s(r.revision), s(r.docno), s(r.ppe_docno), s(r.sheet),
  s(r.area_facility), s(r.major_desc), s(r.broad_type), s(r.title),
  s(r.rev_a_transmittal), s(r.rev0_transmittal), s(r.aconex_doc_status), s(r.aconex_review_status),
  r.pct_complete == null ? 0 : Number(r.pct_complete), s(r.doc_owner_initials),
  s(r.comments), s(r.due), s(r.main_group), s(r.sub_group),
  s(r.bh), s(r.drawing_pack), s(r.activity_id), s(r.schedule_status),
]

// ------------------------------------------------------------ Early Works ---
const K038_HEADERS = [
  'Project Number', 'Package Number', 'Area/WBS Code', 'Discipline  ', 'Document Type',
  'Sequence No', 'Revision', 'RDMC Document Number', 'Index', 'Area/WBS Code2',
  'Month', 'Quote No. ', 'Discipline', 'Document Type3', 'Sequence No4', 'Revision2',
  'Sht. # of #', 'PPE Doc Number', 'Phase', 'WBS Description', 'Doc Description',
  'Full Title', 'Document Category', 'Transmittal Date', 'Aconex Doc Status',
  'Aconex Review Status', 'Doc Owner', 'Comments', 'Due Date', 'Main Group',
  'Sub Group', 'BH', 'Drawing Pack', 'Native Received',
]
const K038_WIDTHS = [
  20.29, 20.86, 20.14, 16.0, 20.14, 18.0, 14.14, 28.57, 10.14, 20.14,
  12.29, 15.71, 11.14, 16.14, 14.29, 14.14, 14.86, 30.57, 19.86, 30.0,
  34.0, 59.29, 19.0, 17.14, 24.29, 20.14, 11.86, 14.29, 16.14, 31.14,
  20.71, 9.29, 34.29, 20.0,
]
const k038Cells = (r: Row) => {
  // PPE doc number "Q-24050972-01-9122-I-D12-0043" → Index/Quote/Month/WBS/Disc/Type/Seq
  const p = s(r.ppe_docno).split('-')
  const ok = p.length === 7
  return [
    '6105A', s(r.package_code), s(r.wbs), s(r.discipline), s(r.doc_type),
    s(r.seq_no), s(r.revision), s(r.docno),
    ok ? p[0] : '', ok ? p[3] : s(r.wbs), ok ? p[2] : '', ok ? p[1] : '',
    ok ? p[4] : s(r.discipline), ok ? p[5] : s(r.doc_type), ok ? p[6] : s(r.seq_no), s(r.revision),
    s(r.sheet), s(r.ppe_docno), s(r.phase), s(r.area_facility), s(r.major_desc),
    s(r.title), s(r.broad_type), s(r.rev0_transmittal), s(r.aconex_doc_status),
    s(r.aconex_review_status), s(r.doc_owner_initials), s(r.comments), s(r.due),
    s(r.main_group), s(r.sub_group), s(r.bh), s(r.drawing_pack), s(r.native_received),
  ]
}

const PKGS: Record<string, {
  headers: string[]; widths: number[]; cells: (r: Row) => (string | number)[]
  fill: string; hdrHeight: number; wrap: boolean; borders: boolean; table: boolean
  pctCol: number; retiredSheet: string; filename: string
}> = {
  K124: {
    headers: K124_HEADERS, widths: K124_WIDTHS, cells: k124Cells,
    fill: 'FF00557E', hdrHeight: 24, wrap: true, borders: true, table: false,
    pctCol: K124_HEADERS.indexOf('% Complete') + 1, retiredSheet: 'Docs not in Use',
    filename: '6105AK124-0000-GDDR-0001 - Phase1 CDDL',
  },
  K038: {
    headers: K038_HEADERS, widths: K038_WIDTHS, cells: k038Cells,
    fill: 'FF595959', hdrHeight: 26.25, wrap: false, borders: false, table: true,
    pctCol: 0, retiredSheet: 'Docs not in use',
    filename: 'Q-24050972-8-0000-0001-G-A11 - Early Works CDDL',
  },
}

export async function GET(req: NextRequest) {
  // session gate — any signed-in CoreDocs user
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const pkg = req.nextUrl.searchParams.get('pkg') ?? 'K124'
  const cfg = PKGS[pkg]
  if (!cfg) return NextResponse.json({ error: `Unknown package '${pkg}'` }, { status: 400 })

  const svc = createServiceClient()
  const rows: Row[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await svc
      .from('cddl_doc')
      .select('*')
      .eq('package_code', pkg)
      .order('docno', { ascending: true })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Coreflow — CoreDocs CDDL Register'
  const HDR_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cfg.fill } }
  const CENTER: Partial<ExcelJS.Alignment> = {
    horizontal: 'center', vertical: 'middle', ...(cfg.wrap ? { wrapText: true } : {}),
  }

  const buildSheet = (name: string, data: Row[], asTable: boolean) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    cfg.widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
    if (asTable) {
      ws.addTable({
        name: name.replace(/[^A-Za-z0-9]/g, '_'), ref: 'A1', headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: cfg.headers.map(h => ({ name: h, filterButton: true })),
        rows: data.map(cfg.cells),
      })
    } else {
      ws.addRow(cfg.headers)
      for (const r of data) ws.addRow(cfg.cells(r))
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cfg.headers.length } }
    }
    const hr = ws.getRow(1)
    hr.height = cfg.hdrHeight
    hr.eachCell(c => {
      c.font = HDR_FONT; c.fill = HDR_FILL; c.alignment = CENTER
      if (cfg.borders) c.border = BORDER
    })
    for (let i = 2; i <= data.length + 1; i++) {
      const row = ws.getRow(i)
      row.eachCell({ includeEmpty: true }, c => {
        c.font = FONT; c.alignment = CENTER
        if (cfg.borders) c.border = BORDER
      })
      if (cfg.pctCol) row.getCell(cfg.pctCol).numFmt = '0%'
    }
  }

  buildSheet('CDDL', rows.filter(r => !r.retired), cfg.table)
  const retired = rows.filter(r => r.retired)
  if (retired.length) buildSheet(cfg.retiredSheet, retired, false)

  const buf = await wb.xlsx.writeBuffer()
  const today = new Date().toISOString().slice(0, 10)
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${cfg.filename} (Coreflow ${today}).xlsx"`,
    },
  })
}
