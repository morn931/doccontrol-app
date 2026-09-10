/**
 * Server-side sign-off PDF helpers (pdf-lib). Two operations share ONE geometry so a
 * signature always lands in the right row:
 *   - appendSignoffBlock: append an "Approval" page with a row per signatory (empty).
 *   - stampSignature:     stamp a signatory's signature + date into their row.
 * The approval page is always the LAST page of the document.
 */
import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage } from 'pdf-lib'

// ── Rotated pages ────────────────────────────────────────────────────────────
// A page can carry /Rotate 90, 180 or 270: its content is stored one way and SHOWN turned.
// pdf.js reports text positions, and pdf-lib draws, in the STORED (unrotated) space — so on a
// rotated drawing "above the label" pointed sideways, and the stamp came out sideways too.
// 6105AK124-6241-ELAY-0001 (2026-09-10, ticket 647b4156) is stored at /Rotate 270: Ian
// Steynberg's signature was drawn turned 90°, small, in the neighbouring box, and the date ran
// vertically across "CHECKED BY / I STEYNBERG".
//
// So on a rotated page the geometry is worked out in DISPLAY space — as the reader sees the
// page — and converted back to stored space only to draw, with the ink turned to match.
// Placements stay stored in stored space, as they always have been.
//
// ⚠ An UPRIGHT page never enters this path. Every function below keeps its original code for
// rot 0 verbatim, so the 58 upright drawings signed before this change behave identically by
// construction, not by arithmetic.

/** A page's stored-space box and its display rotation (clockwise, as /Rotate means). */
export type PageFrame = { rot: 0 | 90 | 180 | 270; x0: number; y0: number; w: number; h: number }

const normRot = (a: number): PageFrame['rot'] => ((((Math.round(a / 90) * 90) % 360) + 360) % 360) as PageFrame['rot']

function frameOfPage(page: PDFPage): PageFrame {
  const box = page.getCropBox()
  return { rot: normRot(page.getRotation().angle), x0: box.x, y0: box.y, w: box.width, h: box.height }
}

/** Stored → display (origin bottom-left of the page as shown). */
export function toDisplay(f: PageFrame, x: number, y: number): { x: number; y: number } {
  const u = x - f.x0, v = y - f.y0
  switch (f.rot) {
    case 90: return { x: v, y: f.w - u }
    case 180: return { x: f.w - u, y: f.h - v }
    case 270: return { x: f.h - v, y: u }
    default: return { x: u, y: v }
  }
}

/** Display → stored. The exact inverse of toDisplay. */
export function toStored(f: PageFrame, X: number, Y: number): { x: number; y: number } {
  let u: number, v: number
  switch (f.rot) {
    case 90: u = f.w - Y; v = X; break
    case 180: u = f.w - X; v = f.h - Y; break
    case 270: u = Y; v = f.h - X; break
    default: u = X; v = Y
  }
  return { x: u + f.x0, y: v + f.y0 }
}

type Rect = { x: number; y: number; w: number; h: number }
function rectVia(conv: (x: number, y: number) => { x: number; y: number }, r: Rect): Rect {
  const a = conv(r.x, r.y), b = conv(r.x + r.w, r.y + r.h)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}
const rectToDisplay = (f: PageFrame, r: Rect) => rectVia((x, y) => toDisplay(f, x, y), r)
const rectToStored = (f: PageFrame, r: Rect) => rectVia((x, y) => toStored(f, x, y), r)

/** A nudge the signatory pressed (↑ ↓ ← →, in display terms) as a move in stored space. */
export function nudgeToStored(f: PageFrame | null | undefined, dx: number, dy: number): { dx: number; dy: number } {
  switch (f?.rot) {
    case 90: return { dx: -dy, dy: dx }
    case 180: return { dx: -dx, dy: -dy }
    case 270: return { dx: dy, dy: -dx }
    default: return { dx, dy }
  }
}

/** The frame of a given 1-based page — for callers outside a rebuild (the nudge route). */
export async function pageFrameOf(pdfBytes: ArrayBuffer | Uint8Array, page1: number): Promise<PageFrame> {
  const doc = await PDFDocument.load(pdfBytes)
  const pages = doc.getPages()
  return frameOfPage(pages[Math.min(Math.max(page1, 1), pages.length) - 1] ?? pages[0])
}

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
      const img = await embedStampImage(doc, opts.signaturePng)
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

// `frame` is present ONLY on a rotated page, and then x/y are in DISPLAY space. An upright
// page's columns are exactly what they always were: stored-space x/y/w and nothing else.
type Col = { x: number; y: number; w: number; frame?: PageFrame }

async function pageOneWords(pdfBytes: ArrayBuffer | Uint8Array): Promise<{ words: { str: string; x: number; y: number; w: number }[]; frame: PageFrame }> {
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
      const [vx0, vy0, vx1, vy1] = page.view as number[]
      const frame: PageFrame = { rot: normRot(page.rotate ?? 0), x0: vx0, y0: vy0, w: vx1 - vx0, h: vy1 - vy0 }
      const words = (tc.items as any[]).filter(i => typeof i.str === 'string').map(i => {
        // `width` is measured along the text's own direction, so for a label that READS
        // across the page as displayed it is already the display width.
        if (frame.rot === 0) return { str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }
        const d = toDisplay(frame, i.transform[4], i.transform[5])
        return { str: i.str, x: d.x, y: d.y, w: i.width }
      })
      return { words, frame }
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
  let words, frame: PageFrame
  try { ({ words, frame } = await pageOneWords(pdfBytes)) } catch { return null }
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
    if (m) cols[kw] = frame.rot === 0 ? { x: m.x, y: m.y, w: m.w } : { x: m.x, y: m.y, w: m.w, frame }
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
      const img = await embedStampImage(doc, opts.signaturePng)
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

/** Embed a stored signature by what it ACTUALLY is, not by what the field is called.
 *  coreflow_signature accepts PNG or JPEG, and at least one person's saved signature is a
 *  raw phone JPEG (Lonice Willemse, found 2026-09-04). embedPng on JPEG bytes throws, and
 *  every call site catches that and quietly stamps the typed name instead — so she would
 *  have had a signature on file and a typed name on the drawing, with nothing saying why. */
async function embedStampImage(doc: PDFDocument, bytes: Uint8Array) {
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return jpeg ? doc.embedJpg(bytes) : doc.embedPng(bytes)
}

// Decode a data-URL / base64 PNG or JPEG (as returned by the signature store) to bytes.
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
    const box = { x: col.x + col.w / 2 - w / 2, y: col.y + 26, w, h }
    // A rotated page's column is in display space: "above the name" is worked out as the page
    // is seen, and only the finished box goes back to stored space (w/h swap at 90/270).
    if (col.frame) return { page: 1, ...rectToStored(col.frame, box) }
    return { page: 1, ...box }
  }
  const g = rowGeom(blockRow)                 // appended page is added after the base
  return { page: basePageCount + 1, x: g.sigX, y: g.sigY, w: g.sigW, h: g.sigH }
}

/** True when a placement is still sitting in its untouched appended-approval-sheet row (the box
 *  appendSignoffBlock drew for it) rather than in a title-block column or somewhere nudged. */
function isAppendedRowBox(p: Placement): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5
  // HEIGHT as well as x/w/h. A nudge moves place_x/place_y and never w/h, so a pure up/down
  // nudge keeps x = COL.sig — testing x/w/h alone let it pass as "untouched", and its date then
  // jumped into the Date column 12–36pt off the rule. rowGeom puts row i's box at
  // sigY = HEADER_Y − 20 − i·ROW_H − SIG_H − 10, so an untouched box is a whole number of rows
  // below the first. Anything else was moved, and keeps the relative offset below.
  const rows = (HEADER_Y - 30 - SIG_H - p.y) / ROW_H
  const onARow = rows > -0.01 && Math.abs(rows - Math.round(rows)) * ROW_H < 0.5
  return near(p.x, COL.sig) && near(p.w, SIG_W) && near(p.h, SIG_H) && onARow
}

/** Where the date sits by default, relative to a signature placement — same spot it's always
 *  rendered at when no independent date position has been saved yet. Used as the starting point
 *  the first time a signatory nudges their date (so it starts exactly where it's currently
 *  showing, not somewhere new). */
export function defaultDatePos(p: Placement, frame?: PageFrame | null): { x: number; y: number } {
  // On a rotated page "16pt below the box" means below it AS SEEN — in stored space that is
  // sideways, which is how the date ended up running vertically across a title block. The
  // appended sheet is never rotated (pdf-lib adds it upright), so this never meets the branch
  // below it.
  if (frame && frame.rot !== 0) {
    const d = rectToDisplay(frame, p)
    return toStored(frame, d.x, d.y - 16)
  }
  // On the appended approval sheet the date belongs in that sheet's OWN "Date" column — it prints
  // a Date header and a date rule at COL.date, and the pre-movable stampSignature filled it in
  // there. The relative offset below the box (added when dates became movable) left the Date
  // column empty and the date floating under the signature. A signature nudged out of its row
  // (or one in a title-block column) keeps the relative offset, so its date travels with it.
  if (isAppendedRowBox(p)) {
    // rowGeom: sigY = top - SIG_H - 10 and textY = top - 22, i.e. the row's text baseline.
    return { x: COL.date, y: p.y + SIG_H + 10 - 22 }
  }
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
    // Clamping an out-of-range page is how a signature once landed in the middle of a drawing:
    // the placement pointed at an appended approval sheet that was never appended. The caller
    // now appends that sheet when any stamp needs it, so this should be unreachable — say so
    // out loud if it ever happens again rather than silently putting ink somewhere wrong.
    if (s.page > pages.length || s.page < 1) {
      console.warn(`[signoff] stamp targets page ${s.page} of a ${pages.length}-page document — clamping. The approval sheet was expected and is missing.`)
    }
    const page = pages[Math.min(Math.max(s.page, 1), pages.length) - 1]
    if (!page) continue
    const frame = frameOfPage(page)
    if (frame.rot !== 0) {
      await drawRotatedStamp(doc, page, frame, s, font, ink)
      continue
    }
    if (s.png?.byteLength) {
      try {
        const img = await embedStampImage(doc, s.png)
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

/** One stamp on a ROTATED page. The same fit, the same offsets, the same date rule as the
 *  upright path in rebuildSignedPdf — all worked out as the page is SEEN — then each mark is
 *  anchored in stored space and turned by the page's rotation so it reads the right way up.
 *  pdf-lib turns counter-clockwise and /Rotate turns the display clockwise: drawing at +rot is
 *  exactly undone by the page's own turn. */
async function drawRotatedStamp(
  doc: PDFDocument, page: PDFPage, frame: PageFrame, s: StampSpec,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>, ink: ReturnType<typeof rgb>,
): Promise<void> {
  const turn = degrees(frame.rot)
  const d = rectToDisplay(frame, s)                       // the box as the reader sees it
  const at = (X: number, Y: number) => toStored(frame, X, Y)
  const typed = () => {
    if (!s.typedName) return
    const o = at(d.x + 4, d.y + d.h / 2 - 5)
    page.drawText(s.typedName, { x: o.x, y: o.y, size: 10, font, color: ink, rotate: turn })
  }
  if (s.png?.byteLength) {
    try {
      const img = await embedStampImage(doc, s.png)
      const scale = Math.min(d.w / img.width, d.h / img.height)
      const w = img.width * scale, h = img.height * scale
      const o = at(d.x + (d.w - w) / 2, d.y + (d.h - h) / 2)
      page.drawImage(img, { x: o.x, y: o.y, width: w, height: h, rotate: turn })
    } catch { typed() }
  } else typed()
  if (s.dateStr) {
    // A saved date position is stored-space like every placement; the default is "16pt below
    // the box as seen" (defaultDatePos with the frame), never below it in stored space.
    const dp = s.dateX != null && s.dateY != null ? { x: s.dateX, y: s.dateY } : defaultDatePos(s, frame)
    page.drawText(s.dateStr, { x: dp.x, y: dp.y, size: 8, font, color: ink, rotate: turn })
  }
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
