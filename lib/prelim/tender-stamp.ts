// "ISSUED FOR TENDER ONLY" stamp — drawn on every page of a PDF, top right, red on white,
// with the date it was stamped. Pure pdf-lib; no Next/Supabase imports so a script can run
// it over real drawings (scripts/_tender-stamp-trial.mjs did, 2026-09-07, A1 landscape,
// A3 landscape, A4 portrait, and a /Rotate 90 sheet) before it went behind the button.
//
// The stamp scales with the page (an A1 sheet and an A3 sheet get the same relative size)
// and is placed in VISUAL top-right whatever the page's /Rotate says — the arithmetic below
// maps visual coordinates onto the PDF's own axes for 0/90/180/270.
import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage, type PDFFont } from 'pdf-lib'

export const TENDER_STAMP_LINE_1 = 'ISSUED FOR TENDER ONLY'
export const TENDER_STAMP_LINE_2 = 'Not to be used for Manufacturing, Detailed Design or Construction'

const RED = rgb(0.80, 0.05, 0.05)
const WHITE = rgb(1, 1, 1)

/** The date as it is printed on the stamp — South African local date, long form. */
export function tenderStampDate(d = new Date()): string {
  return d.toLocaleDateString('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'long', year: 'numeric' })
}

export async function stampIssuedForTender(pdfBytes: Uint8Array | ArrayBuffer, dateText = tenderStampDate()): Promise<{ bytes: Uint8Array; pages: number }> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  for (const page of pages) stampPage(page, bold, reg, dateText)
  const bytes = await pdf.save({ useObjectStreams: false })
  return { bytes, pages: pages.length }
}

function stampPage(page: PDFPage, bold: PDFFont, reg: PDFFont, dateText: string) {
  const { width: pw, height: ph } = page.getSize()
  const rot = ((page.getRotation().angle % 360) + 360) % 360
  // visual width/height as the reader sees the page
  const W = rot === 90 || rot === 270 ? ph : pw
  const H = rot === 90 || rot === 270 ? pw : ph
  // visual (vx from left, vy from top) → PDF user space
  const place = (vx: number, vy: number): [number, number] => {
    switch (rot) {
      case 90:  return [vy, vx]
      case 180: return [pw - vx, vy]
      case 270: return [pw - vy, ph - vx]
      default:  return [vx, H - vy]
    }
  }

  // A DRAWING (landscape sheet, A3 or larger) carries the stamp in the revision table at
  // bottom left — the rows there are empty on a tender issue, and top right was covering
  // legends and key plans (Morné, 8 Sep). A document (portrait, or smaller than A3) keeps
  // the stamp top right, where a report or schedule has nothing to lose.
  const drawing = isDrawingPage(W, H)
  // sizes: relative to the visual width, clamped so an A4 stays legible and an A0 stays a stamp
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const s1 = clamp(W * (drawing ? 0.0155 : 0.020), 11, 46)   // ISSUED FOR TENDER ONLY
  const s2 = clamp(W * (drawing ? 0.0075 : 0.0095), 6.5, 22) // the restriction line
  const s3 = clamp(W * (drawing ? 0.0075 : 0.0095), 6.5, 22) // the date
  const pad = s1 * 0.55
  const margin = clamp(W * 0.012, 8, 36)
  const border = clamp(s1 * 0.09, 1, 4)
  const line1W = bold.widthOfTextAtSize(TENDER_STAMP_LINE_1, s1)
  const line2W = reg.widthOfTextAtSize(TENDER_STAMP_LINE_2, s2)
  const line3 = `Stamped ${dateText}`
  const line3W = reg.widthOfTextAtSize(line3, s3)
  const bw = Math.max(line1W, line2W, line3W) + pad * 2
  const bh = pad + s1 * 1.15 + s2 * 1.5 + s3 * 1.4 + pad * 0.8
  // visual top-left of the box: top right for a document; inside the revision table,
  // bottom left, for a drawing (the PPE frame's rev rows sit above the bottom border)
  const vx0 = drawing ? W * 0.045 : W - margin - bw
  const vy0 = drawing ? H - H * 0.034 - bh : margin

  // the box: map two opposite visual corners, normalise
  const [ax, ay] = place(vx0, vy0), [bx, by] = place(vx0 + bw, vy0 + bh)
  page.drawRectangle({
    x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay),
    // white fill at 47% (Morné, 8 Sep: half as opaque as before) so what is under the stamp
    // stays readable; the red border and the red text stay fully opaque
    color: WHITE, borderColor: RED, borderWidth: border, opacity: 0.47, borderOpacity: 1,
  })
  // text lines, centred in the box; each drawn at its baseline, rotated with the page
  const rotate = degrees(rot)
  const centred = (text: string, font: PDFFont, size: number, vyTop: number) => {
    const tw = font.widthOfTextAtSize(text, size)
    const [x, y] = place(vx0 + (bw - tw) / 2, vyTop + size)
    page.drawText(text, { x, y, size, font, color: RED, rotate })
  }
  let vy = vy0 + pad * 0.7
  centred(TENDER_STAMP_LINE_1, bold, s1, vy); vy += s1 * 1.15
  centred(TENDER_STAMP_LINE_2, reg, s2, vy);  vy += s2 * 1.5
  centred(line3, reg, s3, vy)
}

/** Landscape and at least A3 wide (1190 pt) = a drawing sheet with a title block and a
 *  revision table. Everything else is treated as a document. */
export const isDrawingPage = (visualW: number, visualH: number) => visualW > visualH && visualW >= 1150

/** "<name>.pdf" → "<name> - ISSUED FOR TENDER.pdf" */
export const tenderCopyName = (fileName: string) => fileName.replace(/\.pdf$/i, '') + ' - ISSUED FOR TENDER.pdf'
