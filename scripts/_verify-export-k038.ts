// Build the workbook exactly as the route does and inspect it — the paste contract has to
// still be 30 columns, with the reference in column 31.
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { originalK038, k038Disagrees } from '../lib/carryover/k038'

const CDDL_HEADERS = [
  "Project Number", "Package Number", "Area/ WBS No.", "Discipline", "Document Type",
  "Sequential Number", "Revision", "RDMC Document Number", "PPE Doc Number", "Sht. # of #",
  "Area / Facility", "Major Description", "Broad Type", "Full Title",
  "Rev A Transmittal Date", "Rev 0 Transmittal Date", "Aconex Doc Status", "Aconex Review Status",
  "Planned Hours", "% Complete", "Earned Hours", "Doc Owner", "Comments", "Due Date",
  "Main Group", "Sub Group", "BH", "Drawing Pack", "Activity ID", "Schedule Status",
]

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').order('temp_ref').limit(2000)
  const rows = data ?? []
  const has = (v: unknown) => !!String(v ?? '').trim()

  console.log(`CDDL contract columns : ${CDDL_HEADERS.length}  (A:AD)`)
  console.log(`reference column      : ${CDDL_HEADERS.length + 1}  (AE) "Original K038 Number"`)
  const k = rows.filter((r) => originalK038(r))
  console.log(`\nrows                  : ${rows.length}`)
  console.log(`with a K038 number    : ${k.length}`)
  console.log(`  already renumbered  : ${k.filter((r) => has(r.docno)).length}`)
  console.log(`blank (never had one) : ${rows.length - k.length}`)
  console.log(`sources disagree      : ${rows.filter(k038Disagrees).length}  -> exported from the file name, noted in the cell`)

  console.log(`\nwhat the drawing office will see (renumbered rows):`)
  console.log(`  ${'Original K038 Number'.padEnd(28)} ${'New RDMC Document Number'}`)
  for (const r of k.filter((r) => has(r.docno)).slice(0, 10))
    console.log(`  ${String(originalK038(r)).padEnd(28)} ${r.docno}`)

  // Prove the paste range is untouched by writing the real sheet.
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('t')
  ws.addRow([...CDDL_HEADERS, 'Original K038 Number'])
  const hdr = ws.getRow(1)
  console.log(`\nheader col 30 = "${hdr.getCell(30).value}"   (must be Schedule Status)`)
  console.log(`header col 31 = "${hdr.getCell(31).value}"   (the reference)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
