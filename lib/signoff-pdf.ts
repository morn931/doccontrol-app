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
  const src = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes)
  // pdf.js TRANSFERS/detaches the `data` buffer it's given. Hand it a fresh COPY each time so
  // (a) the caller's bytes survive for the subsequent pdf-lib load, and (b) a retry can reuse
  // the source. This was silently breaking title-block placement (the load after this saw an
  // empty buffer, or the whole detect threw → every signature fell back to the appended sheet).
  const load = async (opts: any) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(src), isEvalSupported: false, verbosity: 0, ...opts }).promise
    try {
      const page = await doc.getPage(1)
      const tc = await page.getTextContent()
      return (tc.items as any[]).filter(i => typeof i.str === 'string')
        .map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))
    } finally { await doc.destroy() }
  }
  // Serverless-safe first (no system-font lookups / FontFace — Vercel has neither, which made
  // the previous `useSystemFonts:true` throw). Fall back to the most permissive options.
  try { return await load({ useSystemFonts: false, disableFontFace: true }) }
  catch { return await load({}) }
}

/** Locate the PREPARED/CHECKED/APPROVED columns on the cover page. Returns null if the
 *  title block isn't present (→ caller uses the appended-block fallback). */
export async function findTitleBlockColumns(pdfBytes: ArrayBuffer | Uint8Array): Promise<Record<string, Col> | null> {
  let words
  try { words = await pageOneWords(pdfBytes) } catch { return null }
  const cols: Record<string, Col> = {}
  for (const kw of ['PREPARED', 'CHECKED', 'APPROVED']) {
    // Match the actual title-block label "<KW> BY" — NOT any prose that merely contains
    // the word. On PPE datasheets the APPROVED column used to be hijacked by the cover
    // disclaimer ("The document is NOT approved until an RDMC Approval stamp…") or by
    // "STATUS APPROVAL BY …", which sit higher up the page — so the Approver's signature
    // was misplaced (and fell back to the appended sheet). "PREPARED/CHECKED/APPROVED BY"
    // is the label we want.
    let m = words.find(w => w.str.toUpperCase().includes(`${kw} BY`))
    if (!m) {
      // Fallback for templates that split the label into separate tokens: a SHORT token
      // containing the keyword, nearest the page foot (title blocks sit at the bottom).
      m = words
        .filter(w => w.str.toUpperCase().includes(kw) && w.str.trim().length <= 15)
        .sort((a, b) => a.y - b.y)[0]
    }
    if (m) cols[kw] = { x: m.x, y: m.y, w: m.w }
  }
  return Object.keys(cols).length ? cols : null
}

const ROLE_TO_COL: [string, string][] = [['prepar', 'PREPARED'], ['compil', 'PREPARED'], ['check', 'CHECKED'], ['review', 'CHECKED'], ['approv', 'APPROVED']]

/** The title-block column a free-text role label signs in, or null if it maps to none.
 *  A document WITH a title block has nowhere to put an unmapped role, so callers that
 *  create a sign-off chain must reject one up front (see signoff/start). */
export function roleColumnKey(roleLabel: string | null | undefined): string | null {
  const rl = (roleLabel || '').toLowerCase()
  return ROLE_TO_COL.find(([frag]) => rl.includes(frag))?.[1] ?? null
}

/** The role labels a title-block document accepts — shown to the user when one is rejected. */
export const TITLE_BLOCK_ROLES = ['Prepared', 'Checked', 'Reviewed', 'Approved'] as const

/** Stamp a signature into the title-block column matching the signatory's role, above the
 *  name. Returns placed:false if the block/column isn't found (caller falls back). */
export async function stampOnTitleBlock(
  pdfBytes: ArrayBuffer | Uint8Array,
  opts: { roleLabel?: string | null; dateStr: string; signaturePng?: Uint8Array | null; typedName?: string }
): Promise<{ bytes: Uint8Array; placed: boolean }> {
  const asBytes = () => (pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes))
  const cols = await findTitleBlockColumns(pdfBytes)
  if (!cols) return { bytes: asBytes(), placed: false }

  const key = roleColumnKey(opts.roleLabel)
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

// ── Movable signatures — placement + non-destructive rebuild ─────────────────
// A signature's placement is a box in PDF points (origin bottom-left), on a 1-based page.
// The signed PDF is always REBUILT from the clean base (optionally + the appended block), so
// moving a signature never stacks or smears earlier stamps.

export type Placement = { page: number; x: number; y: number; w: number; h: number }
export type StampSpec = Placement & {
  png?: Uint8Array | null; typedName?: string; dateStr?: string | null
  // Absolute PDF-point position for the date. Optional — when absent, falls back to the
  // relative offset below the signature box (see rebuildSignedPdf), which is what every
  // placement had before dates could be positioned independently.
  dateX?: number; dateY?: number
}

/** The default box for a signatory: the title-block column matching their role (page 1), or —
 *  when there's no title block — their row on the appended approval page (basePageCount + 1). */
export function defaultPlacement(
  roleLabel: string | null | undefined,
  blockRow: number,
  cols: Record<string, Col> | null,
  basePageCount: number,
): Placement {
  const key = roleColumnKey(roleLabel)
  const col = key && cols ? cols[key] : null
  if (col) {
    const w = 104, h = 40   // signature box — sits in the title-block column above the name
    return { page: 1, x: col.x + col.w / 2 - w / 2, y: col.y + 26, w, h }
  }
  const g = rowGeom(blockRow)                 // appended page is added after the base
  return { page: basePageCount + 1, x: g.sigX, y: g.sigY, w: g.sigW, h: g.sigH }
}

/** Where the date sits by default, relative to a signature placement — same spot it's always
 *  rendered at when no independent date position has been saved yet. Used as the starting point
 *  the first time a signatory nudges their date (so it starts exactly where it's currently
 *  showing, not somewhere new). */
export function defaultDatePos(p: Placement): { x: number; y: number } {
  return { x: p.x, y: p.y - 16 }
}

/** Rebuild the signed PDF from the clean base: optionally append the approval block (when the
 *  document has no title block), then stamp every placement. Deterministic and repeatable. */
export async function rebuildSignedPdf(
  baseBytes: ArrayBuffer | Uint8Array,
  opts: {
    appendSignatories?: SignatoryRow[] | null
    appendMeta?: { title?: string; reference?: string }
    stamps: StampSpec[]
  },
): Promise<Uint8Array> {
  let bytes: ArrayBuffer | Uint8Array = baseBytes
  if (opts.appendSignatories?.length) {
    ({ bytes } = await appendSignoffBlock(baseBytes, opts.appendSignatories, opts.appendMeta ?? {}))
  }
  const doc = await PDFDocument.load(bytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  const ink = rgb(0.09, 0.11, 0.16)
  for (const s of opts.stamps) {
    const page = pages[Math.min(Math.max(s.page, 1), pages.length) - 1]
    if (!page) continue
    if (s.png?.byteLength) {
      try {
        const img = await doc.embedPng(s.png)
        const scale = Math.min(s.w / img.width, s.h / img.height)
        const w = img.width * scale, h = img.height * scale
        page.drawImage(img, { x: s.x + (s.w - w) / 2, y: s.y + (s.h - h) / 2, width: w, height: h })
      } catch {
        if (s.typedName) page.drawText(s.typedName, { x: s.x + 4, y: s.y + s.h / 2 - 5, size: 10, font, color: ink })
      }
    } else if (s.typedName) {
      page.drawText(s.typedName, { x: s.x + 4, y: s.y + s.h / 2 - 5, size: 10, font, color: ink })
    }
    // Independent position if the signatory has nudged their date; else the same relative
    // offset every placement used before dates could be moved on their own (see defaultDatePos).
    if (s.dateStr) {
      const dp = s.dateX != null && s.dateY != null ? { x: s.dateX, y: s.dateY } : defaultDatePos(s)
      page.drawText(s.dateStr, { x: dp.x, y: dp.y, size: 8, font, color: ink })
    }
  }
  return doc.save()
}

// Page count of a PDF (for the appended-page index).
export async function pageCountOf(pdfBytes: ArrayBuffer | Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes)
  return doc.getPageCount()
}

// Width/height (points) of a given 1-based page — used to clamp a reposition to the page.
export async function pageSizeOf(pdfBytes: ArrayBuffer | Uint8Array, page1: number): Promise<{ w: number; h: number }> {
  const doc = await PDFDocument.load(pdfBytes)
  const pages = doc.getPages()
  const p = pages[Math.min(Math.max(page1, 1), pages.length) - 1] ?? pages[0]
  return { w: p.getWidth(), h: p.getHeight() }
}
