/**
 * Server-side sign-off PDF helpers (pdf-lib). Two operations share ONE geometry so a
 * signature always lands in the right row:
 *   - appendSignoffBlock: append an "Approval" page with a row per signatory (empty).
 *   - stampSignature:     stamp a signatory's signature + date into their row.
 * The approval page is always the LAST page of the document.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PAGE_W = 595.28   // A4 portrait
const PAGE_H = 841.89
const HEADER_Y = 740
const ROW_H = 95
const COL = { role: 40, name: 150, sig: 285, date: 470 }
const SIG_W = 165
const SIG_H = 55

// Geometry for one signatory row (0-based). Returns the y of the row's top rule and the
// signature box origin — identical at append time and stamp time.
function rowGeom(i: number) {
  const top = HEADER_Y - 20 - i * ROW_H     // top rule of this row
  return {
    top,
    textY: top - 22,                        // baseline for role/name/date text
    sigX: COL.sig, sigY: top - SIG_H - 10, sigW: SIG_W, sigH: SIG_H,
    dateX: COL.date,
  }
}

export type SignatoryRow = { name: string; role: string }

export async function appendSignoffBlock(
  pdfBytes: ArrayBuffer | Uint8Array,
  signatories: SignatoryRow[],
  opts: { title?: string; reference?: string } = {}
): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await PDFDocument.load(pdfBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ink = rgb(0.09, 0.11, 0.16)
  const grey = rgb(0.45, 0.48, 0.53)

  page.drawText('Document Approval — Sign-off', { x: 40, y: 800, size: 16, font: bold, color: ink })
  const sub = [opts.title, opts.reference].filter(Boolean).join('   ·   ')
  if (sub) page.drawText(sub, { x: 40, y: 782, size: 10, font, color: grey })

  // Header row
  page.drawText('Role', { x: COL.role, y: HEADER_Y, size: 10, font: bold, color: grey })
  page.drawText('Name', { x: COL.name, y: HEADER_Y, size: 10, font: bold, color: grey })
  page.drawText('Signature', { x: COL.sig, y: HEADER_Y, size: 10, font: bold, color: grey })
  page.drawText('Date', { x: COL.date, y: HEADER_Y, size: 10, font: bold, color: grey })
  page.drawLine({ start: { x: 40, y: HEADER_Y - 6 }, end: { x: PAGE_W - 40, y: HEADER_Y - 6 }, thickness: 0.75, color: grey })

  signatories.forEach((s, i) => {
    const g = rowGeom(i)
    page.drawText(s.role || '—', { x: COL.role, y: g.textY, size: 10, font, color: ink })
    page.drawText(s.name || '', { x: COL.name, y: g.textY, size: 10, font, color: ink })
    // signature box + a date rule
    page.drawRectangle({ x: g.sigX, y: g.sigY, width: g.sigW, height: g.sigH, borderColor: rgb(0.8, 0.82, 0.85), borderWidth: 0.75 })
    page.drawLine({ start: { x: g.dateX, y: g.textY - 4 }, end: { x: g.dateX + 90, y: g.textY - 4 }, thickness: 0.75, color: rgb(0.8, 0.82, 0.85) })
    // row separator
    page.drawLine({ start: { x: 40, y: g.top - ROW_H + 15 }, end: { x: PAGE_W - 40, y: g.top - ROW_H + 15 }, thickness: 0.4, color: rgb(0.9, 0.91, 0.93) })
  })

  const bytes = await doc.save()
  return { bytes, count: signatories.length }
}

export async function stampSignature(
  pdfBytes: ArrayBuffer | Uint8Array,
  opts: { blockRow: number; dateStr: string; signaturePng?: Uint8Array | null; typedName?: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  const page = pages[pages.length - 1]       // approval page is always last
  const g = rowGeom(opts.blockRow)
  const ink = rgb(0.09, 0.11, 0.16)

  if (opts.signaturePng && opts.signaturePng.byteLength) {
    try {
      const img = await doc.embedPng(opts.signaturePng)
      const scale = Math.min((g.sigW - 8) / img.width, (g.sigH - 8) / img.height)
      const w = img.width * scale, h = img.height * scale
      page.drawImage(img, { x: g.sigX + (g.sigW - w) / 2, y: g.sigY + (g.sigH - h) / 2, width: w, height: h })
    } catch {
      // Not a PNG or embed failed — fall back to a typed signature.
      if (opts.typedName) page.drawText(opts.typedName, { x: g.sigX + 8, y: g.sigY + g.sigH / 2 - 5, size: 12, font, color: ink })
    }
  } else if (opts.typedName) {
    page.drawText(opts.typedName, { x: g.sigX + 8, y: g.sigY + g.sigH / 2 - 5, size: 12, font, color: ink })
  }

  page.drawText(opts.dateStr, { x: g.dateX, y: g.textY, size: 9, font, color: ink })
  return doc.save()
}

// ── Cover-page title block (Prepared / Checked / Approved) ───────────────────
// PPE controlled documents carry a title block at the foot of the cover page with
// PREPARED BY / CHECKED BY / APPROVED BY columns and the engineers' names above the
// labels. Signatures belong there — in the column matching the signatory's role, above
// the name — not on an appended page. We locate the columns with pdfjs (text + position)
// and stamp with pdf-lib. If the block isn't found, callers fall back to appendSignoffBlock.

type Col = { x: number; y: number; w: number }

async function pageOneWords(pdfBytes: ArrayBuffer | Uint8Array): Promise<{ str: string; x: number; y: number; w: number }[]> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes)
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise
  try {
    const page = await doc.getPage(1)
    const tc = await page.getTextContent()
    return (tc.items as any[]).filter(i => typeof i.str === 'string')
      .map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))
  } finally { await doc.destroy() }
}

/** Locate the PREPARED/CHECKED/APPROVED columns on the cover page. Returns null if the
 *  title block isn't present (→ caller uses the appended-block fallback). */
export async function findTitleBlockColumns(pdfBytes: ArrayBuffer | Uint8Array): Promise<Record<string, Col> | null> {
  let words
  try { words = await pageOneWords(pdfBytes) } catch { return null }
  const cols: Record<string, Col> = {}
  for (const kw of ['PREPARED', 'CHECKED', 'APPROVED']) {
    const m = words.find(w => w.str.toUpperCase().includes(kw))
    if (m) cols[kw] = { x: m.x, y: m.y, w: m.w }
  }
  return Object.keys(cols).length ? cols : null
}

const ROLE_TO_COL: [string, string][] = [['prepar', 'PREPARED'], ['compil', 'PREPARED'], ['check', 'CHECKED'], ['review', 'CHECKED'], ['approv', 'APPROVED']]

/** Stamp a signature into the title-block column matching the signatory's role, above the
 *  name. Returns placed:false if the block/column isn't found (caller falls back). */
export async function stampOnTitleBlock(
  pdfBytes: ArrayBuffer | Uint8Array,
  opts: { roleLabel?: string | null; dateStr: string; signaturePng?: Uint8Array | null; typedName?: string }
): Promise<{ bytes: Uint8Array; placed: boolean }> {
  const asBytes = () => (pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes))
  const cols = await findTitleBlockColumns(pdfBytes)
  if (!cols) return { bytes: asBytes(), placed: false }

  const rl = (opts.roleLabel || '').toLowerCase()
  const key = ROLE_TO_COL.find(([frag]) => rl.includes(frag))?.[1] ?? null
  const col = key ? cols[key] : null
  if (!col) return { bytes: asBytes(), placed: false }

  const doc = await PDFDocument.load(pdfBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.getPages()[0]
  const ink = rgb(0.09, 0.11, 0.16)
  const cx = col.x + col.w / 2       // column centre
  const boxW = 66, boxH = 22, by = col.y + 30   // sits above the name row (name ≈ label y + 18)

  if (opts.signaturePng?.byteLength) {
    try {
      const img = await doc.embedPng(opts.signaturePng)
      const scale = Math.min(boxW / img.width, boxH / img.height)
      const w = img.width * scale, h = img.height * scale
      page.drawImage(img, { x: cx - w / 2, y: by, width: w, height: h })
    } catch {
      if (opts.typedName) page.drawText(opts.typedName, { x: col.x, y: by + 4, size: 7, font, color: ink })
    }
  } else if (opts.typedName) {
    page.drawText(opts.typedName, { x: col.x, y: by + 4, size: 7, font, color: ink })
  }
  return { bytes: await doc.save(), placed: true }
}

// Decode a data-URL / base64 PNG (as returned by the signature store) to bytes.
export function pngFromDataUrl(image: string | null | undefined): Uint8Array | null {
  if (!image) return null
  const b64 = image.includes(',') ? image.split(',')[1] : image
  try { return new Uint8Array(Buffer.from(b64, 'base64')) } catch { return null }
}
