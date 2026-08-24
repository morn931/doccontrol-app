import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { getCarryover, isReady, type CarryoverRow } from "@/lib/carryover/carryover";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Export in the REAL CDDL's layout so a finished row pastes straight into K124.
//
// ⚠️ These 30 headers and their order are copied from CoreDocs'
// app/api/cddl/export/route.ts (K124_HEADERS). They are not a design choice here — they
// are a contract. If that export changes, this must change with it, or the paste lands
// one column out and nobody notices until the register is wrong.
const CDDL_HEADERS = [
  "Project Number", "Package Number", "Area/ WBS No.", "Discipline", "Document Type",
  "Sequential Number", "Revision", "RDMC Document Number", "PPE Doc Number", "Sht. # of #",
  "Area / Facility", "Major Description", "Broad Type", "Full Title",
  "Rev A Transmittal Date", "Rev 0 Transmittal Date", "Aconex Doc Status", "Aconex Review Status",
  "Planned Hours", "% Complete", "Earned Hours", "Doc Owner", "Comments", "Due Date",
  "Main Group", "Sub Group", "BH", "Drawing Pack", "Activity ID", "Schedule Status",
];

const s = (v: unknown) => (v == null ? "" : String(v));

const cddlRow = (r: CarryoverRow) => [
  "6105A", "K124", s(r.wbs), s(r.discipline), s(r.doc_type),
  s(r.seq_no), s(r.revision), s(r.docno), s(r.ppe_docno), s(r.sheet),
  s(r.area_facility), s(r.major_desc), s(r.broad_type), s(r.title),
  s(r.rev_a_transmittal), s(r.rev0_transmittal), s(r.aconex_doc_status), s(r.aconex_review_status),
  // Planned / Earned hours are computed by CoreDocs from discipline + type against its own
  // estimator. Guessing them here would put a fabricated number into the register, so they
  // are left blank for CoreDocs to fill when the row lands.
  "", "", "", s(r.doc_owner), s(r.comments), s(r.due),
  s(r.main_group), s(r.sub_group), s(r.bh), s(r.drawing_pack), s(r.activity_id), s(r.schedule_status),
];

const NAVY = "FF00557E";   // the CDDL export's own header fill

export async function GET(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const only = req.nextUrl.searchParams.get("only"); // 'ready' to export just the finished rows
  const d = await getCarryover();
  const ready = d.rows.filter(isReady);
  const rows = only === "ready" ? ready : d.rows;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Coreflow — K038 Carry-over Register";

  // ── Sheet 1: paste-ready, CDDL layout, nothing else ───────────────────────
  const ws = wb.addWorksheet("Paste into K124 CDDL", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(CDDL_HEADERS);
  [10, 12, 11, 11, 12, 12, 9, 26, 24, 11, 30, 44, 24, 50, 14, 14, 24, 20, 12, 11, 12, 12, 34, 12, 22, 22, 8, 14, 14, 16]
    .forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let c = 1; c <= CDDL_HEADERS.length; c++) {
    const cell = ws.getRow(1).getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  ws.getRow(1).height = 24;
  for (const r of rows) ws.addRow(cddlRow(r));

  // ── Sheet 2: the same rows WITH their provenance, for checking ────────────
  // The paste sheet deliberately carries no temp ref or file name — those columns do not
  // exist in the CDDL and would break the paste. They live here instead, so a row can
  // still be traced back to the document it came from.
  const wt = wb.addWorksheet("Traceability", { views: [{ state: "frozen", ySplit: 1 }] });
  const T = ["Ref", "New RDMC number", "Area/WBS", "Ready?", "Legacy number", "Legacy package",
             "Target package", "Document class", "In a project border?", "Number printed on the document",
             "Reader title", "Reader confidence", "Read at", "Read error", "File", "Decided by", "Decided at"];
  wt.addRow(T);
  [10, 26, 11, 9, 26, 14, 24, 20, 20, 28, 44, 14, 20, 34, 60, 26, 20].forEach((w, i) => { wt.getColumn(i + 1).width = w; });
  for (let c = 1; c <= T.length; c++) {
    const cell = wt.getRow(1).getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  }
  for (const r of rows) {
    wt.addRow([
      r.temp_ref, s(r.docno), s(r.wbs), isReady(r) ? "yes" : "no",
      r.legacy_docno ?? "(never numbered)", r.legacy_package ?? "(none)",
      s(r.target_package), s(r.doc_class),
      r.ai_has_border === true ? "yes" : r.ai_has_border === false ? "NO" : "not read",
      s(r.ai_docno), s(r.ai_title), s(r.ai_confidence), s(r.ai_read_at).slice(0, 16),
      s(r.ai_error), s(r.source_path), s(r.decided_by), s(r.decided_at).slice(0, 16),
    ]);
  }

  // ── Sheet 3: what this is and how to use it ───────────────────────────────
  const wn = wb.addWorksheet("Read me");
  for (const line of [
    ["K038 CARRY-OVER — export", ""],
    ["Generated", new Date().toISOString().slice(0, 16).replace("T", " ")],
    [],
    ["Sheet 1 'Paste into K124 CDDL'", "the CDDL's own 30 columns, in its own order — copy the rows straight in"],
    ["Sheet 2 'Traceability'", "the same rows plus where each came from, what the reader found, and who decided"],
    [],
    ["Rows in this export", rows.length],
    ["  ready (number AND area allocated)", ready.length],
    ["  still to allocate", d.total - ready.length],
    [],
    ["Planned / % / Earned Hours", "left BLANK — CoreDocs computes these from discipline and type when the row lands"],
    ["Documents with no project border", d.withoutBorder],
    ["Documents the reader could not open", d.failed],
    [],
    ["NOTE", "Only rows with both a document number and an area are marked ready. Pasting an unfinished row puts a blank-numbered document into the CDDL."],
  ]) wn.addRow(line);
  wn.getColumn(1).width = 42;
  wn.getColumn(2).width = 96;
  wn.getRow(1).font = { bold: true, size: 13, color: { argb: NAVY } };

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="K038_Carryover_for_CDDL_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
