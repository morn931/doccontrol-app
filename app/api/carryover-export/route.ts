import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { getCarryover, isReady, type CarryoverRow } from "@/lib/carryover/carryover";
import { originalK038, extractK038, k038Disagrees } from "@/lib/carryover/k038";

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

// ⚠️ APPENDED AFTER the 30, never inserted among them. The drawing office knows these
// documents by their OLD number, so the new one is useless to them on its own — but the
// CDDL has no column for it, and putting it anywhere inside A:AD would land every
// subsequent paste one column out. It sits in column 31 (AE) so A:AD is byte-for-byte the
// contract above and can still be selected and pasted on its own.
const K038_HEADER = "Original K038 Number";

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
  // Blank where the document never had a K038 number — most did not, and a blank is what
  // tells the drawing office there is nothing to look up.
  originalK038(r) ?? "",
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

  const withK038 = rows.filter((r) => originalK038(r)).length;
  const withK038Renumbered = rows.filter((r) => originalK038(r) && String(r.docno ?? "").trim()).length;
  const disagree = rows.filter(k038Disagrees).length;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Coreflow — K038 Carry-over Register";

  // ── Sheet 1: paste-ready, CDDL layout, nothing else ───────────────────────
  const ws = wb.addWorksheet("Paste into K124 CDDL", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow([...CDDL_HEADERS, K038_HEADER]);
  [10, 12, 11, 11, 12, 12, 9, 26, 24, 11, 30, 44, 24, 50, 14, 14, 24, 20, 12, 11, 12, 12, 34, 12, 22, 22, 8, 14, 14, 16, 26]
    .forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let c = 1; c <= CDDL_HEADERS.length + 1; c++) {
    const cell = ws.getRow(1).getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  // A different fill on the header, and a tint down the column, so the extra column reads
  // as a reference rather than as one of the CDDL's own.
  const REF_FILL = "FF6B7280";
  ws.getRow(1).getCell(CDDL_HEADERS.length + 1).fill =
    { type: "pattern", pattern: "solid", fgColor: { argb: REF_FILL } };
  ws.getRow(1).height = 24;
  for (const r of rows) {
    const row = ws.addRow(cddlRow(r));
    const cell = row.getCell(CDDL_HEADERS.length + 1);
    cell.font = { size: 10, italic: true, color: { argb: "FF374151" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    // Where the filename and the title block each carry a K038 number and they differ, the
    // filename is exported and the cell says so — the reader's value is on Traceability.
    if (k038Disagrees(r)) {
      cell.note = `The document's title block reads ${extractK038(r.ai_docno)}. The file name's number is exported; see the Traceability sheet.`;
      cell.font = { size: 10, italic: true, color: { argb: "FF92400E" } };
    }
  }

  // ── Sheet 2: the same rows WITH their provenance, for checking ────────────
  // The paste sheet deliberately carries no temp ref or file name — those columns do not
  // exist in the CDDL and would break the paste. They live here instead, so a row can
  // still be traced back to the document it came from.
  const wt = wb.addWorksheet("Traceability", { views: [{ state: "frozen", ySplit: 1 }] });
  const T = ["Ref", "New RDMC number", "Original K038 number", "Sources agree?", "Area/WBS", "Ready?", "Legacy number", "Legacy package",
             "Target package", "Document class", "In a project border?", "Number printed on the document",
             "Reader title", "Reader confidence", "Read at", "Read error", "File", "Decided by", "Decided at"];
  wt.addRow(T);
  [10, 26, 26, 14, 11, 9, 26, 14, 24, 20, 20, 28, 44, 14, 20, 34, 60, 26, 20].forEach((w, i) => { wt.getColumn(i + 1).width = w; });
  for (let c = 1; c <= T.length; c++) {
    const cell = wt.getRow(1).getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  }
  for (const r of rows) {
    wt.addRow([
      r.temp_ref, s(r.docno),
      originalK038(r) ?? "(no K038 number)",
      k038Disagrees(r) ? "NO — file name vs title block" : originalK038(r) ? "yes" : "—",
      s(r.wbs), isReady(r) ? "yes" : "no",
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
    ["Sheet 1 'Paste into K124 CDDL'", "the CDDL's own 30 columns (A:AD), in its own order — copy A:AD straight in"],
    ["  column AE 'Original K038 Number'", "NOT part of the CDDL layout. The number the drawing office knows the document by, so the old and new numbers can be reconciled. Select A:AD only when pasting."],
    ["Sheet 2 'Traceability'", "the same rows plus where each came from, what the reader found, and who decided"],
    [],
    ["Rows in this export", rows.length],
    ["  ready (number AND area allocated)", ready.length],
    ["  still to allocate", d.total - ready.length],
    [],
    ["Planned / % / Earned Hours", "left BLANK — CoreDocs computes these from discipline and type when the row lands"],
    ["Carrying an original K038 number", withK038],
    ["  of those, already renumbered to K124", withK038Renumbered],
    ["File name and title block disagree", disagree === 0 ? "none" : `${disagree} — file name exported, title block on Traceability`],
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
