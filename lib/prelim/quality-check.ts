/**
 * Document quality check for Prelim Review — our own drawings, before they enter review.
 *
 * Same shape as the vendor intake read (lib/intake/ai-review.ts): one Claude pass over the
 * rendered pages, structured output, advisory. Different question: not "does this match the
 * vendor's SDDR" but "is this document fit to go into internal review as it stands" — border
 * and title block, the right PPE template, number / title / revision agreeing with the CDDL
 * entry, revision block filled, status stated, sheet numbering, legibility, blank pages.
 *
 * It reads the SOURCE file (the one in COLAB), never the session's marked-up working copy,
 * because the helper fixes the actual document and presses the button again; a check on the
 * copy would never come clean.
 *
 * Pages sent: a drawing set is read whole up to MAX_PAGES (its title block can be on any
 * sheet); a document sends its first three pages and its last two (cover, TOC, revision
 * block). Every issue carries the sheet/page, a plain description and how to fix it, so the
 * list reads as a job list, not a verdict.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { PDFDocument } from 'pdf-lib'

const MODEL = 'claude-opus-5'
const MAX_PAGES = 8

export interface RegisterExpected {
  document_number?: string | null
  title?: string | null
  revision?: string | null
  discipline?: string | null
  document_type?: string | null
}

const Issue = z.object({
  code: z.enum([
    'no_border', 'no_title_block', 'wrong_template', 'number_missing', 'number_mismatch',
    'title_missing', 'title_mismatch', 'revision_missing', 'revision_mismatch', 'status_missing',
    'revision_block_empty', 'sheet_numbering', 'blank_page', 'orientation', 'legibility',
    'unresolved_placeholder', 'cover_label', 'toc_missing', 'other',
  ]),
  severity: z.enum(['major', 'minor']),
  page: z.number().int().nullable(),          // 1-based, null when it applies to the whole document
  description: z.string(),
  fix: z.string(),
})

export const QualitySchema = z.object({
  document_kind: z.enum(['drawing', 'document']),
  pages_read: z.number().int(),
  title_block: z.object({
    present: z.boolean(),
    template_ok: z.boolean(),
    document_number: z.string(),
    title: z.string(),
    revision: z.string(),
    status_purpose: z.string(),
    date: z.string(),
  }),
  issues: z.array(Issue),
  overall: z.enum(['pass', 'issues']),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string(),
})
export type QualityReport = z.infer<typeof QualitySchema>

export type QualityOutcome =
  | { ok: true; report: QualityReport; usage: { input_tokens: number; output_tokens: number } }
  | { ok: false; error: string }

const SYSTEM = [
  'You are the document quality checker for PPE Technologies, the EPCM engineer on the Reko Diq project (client RDMC).',
  'You are given the pages of one of PPE\'s OWN engineering drawings or documents before it goes into internal review, plus what the document register says it should be.',
  'Read the actual content — border, title block, revision/issue block, sheet numbers, cover and contents pages — and list every quality defect a document controller would send back.',
  'Every issue must say which page, what is wrong in plain words, and what to do about it. Be specific: quote the value you found and the value expected.',
  'Cosmetic differences that a reader would not notice (spacing, case, "kV" vs "kv", a trailing hyphen) are NOT issues. A wrong revision, a number that differs from the register, an empty revision block, a placeholder like "XXX" or "TBA" in a title-block field, an unreadable sheet — these are.',
  'If the register gives no value for a field, do not raise a mismatch for it; only raise "missing" if the title block itself is empty there.',
  'You are advisory. Return only the structured result.',
].join(' ')

const GUIDE = [
  'Checks to run:',
  '- no_border / no_title_block: a drawing sheet must sit in a project border with a title block; a document must have a cover/title page with document number, title and revision.',
  '- wrong_template: the title block or cover is not the PPE / RDMC project template (wrong logo set, missing RDMC number field, foreign layout).',
  '- number_* / title_* / revision_*: compare the title block with the register values given below.',
  '- status_missing: no issue status / purpose (IFR, IFC, IFU, For Approval…) stated.',
  '- revision_block_empty: the revision table has no entry for the revision shown, or no dates / initials.',
  '- sheet_numbering: sheet X of Y inconsistent or missing across a drawing set.',
  '- blank_page / orientation: an empty page, or a landscape sheet rendered rotated.',
  '- legibility: text or linework too small, overlapping, or rasterised to the point of being unreadable at print size.',
  '- unresolved_placeholder: XXX, TBA, TBC, ???, "Enter title" or similar left in a field.',
  '- cover_label / toc_missing: for a multi-section DOCUMENT only — cover page labelled, table of contents present.',
  'Set overall to "pass" when there are no major issues and at most cosmetic minor ones; otherwise "issues".',
].join('\n')

function expectedBlock(e: RegisterExpected | null | undefined): string {
  if (!e) return 'The register holds no entry for this document; check the title block on its own.'
  return [
    'What the document register (CDDL) says this document is:',
    `- document number: ${e.document_number ?? '(not stated)'}`,
    `- title: ${e.title ?? '(not stated)'}`,
    `- revision: ${e.revision ?? '(not stated)'}`,
    `- discipline: ${e.discipline ?? '(not stated)'}`,
    `- document type: ${e.document_type ?? '(not stated)'}`,
  ].join('\n')
}

/** Drawing sets: everything up to MAX_PAGES. Documents: first three + last two. */
async function pagesToSend(bytes: Uint8Array): Promise<{ slim: Uint8Array; total: number; sent: number }> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const total = src.getPageCount()
  if (total <= MAX_PAGES) return { slim: bytes, total, sent: total }
  const idx = [0, 1, 2, total - 2, total - 1].filter((i, k, a) => i >= 0 && a.indexOf(i) === k)
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, idx)
  pages.forEach(p => out.addPage(p))
  return { slim: await out.save(), total, sent: idx.length }
}

const CONVERTED_NOTE =
  'This PDF was rendered from a spreadsheet or Word file by SharePoint at check time. Formula results that depend on ' +
  'OTHER workbooks (external links) cannot resolve in that render and appear as #VALUE!, #REF! or #######. Report those ' +
  'as "formula error in the exported PDF — confirm in Excel" with severity minor, unless the error sits in a title-block ' +
  'field (document number, title, revision, sheet ref), where the issued PDF would carry it and it is major.'

export async function checkDocumentQuality(opts: { pdfBytes: Uint8Array | Buffer; fileName: string; expected?: RegisterExpected | null; converted?: boolean }): Promise<QualityOutcome> {
  try {
    const bytes = opts.pdfBytes instanceof Uint8Array ? opts.pdfBytes : new Uint8Array(opts.pdfBytes)
    let slim = bytes, total = 0, sent = 0
    try { ({ slim, total, sent } = await pagesToSend(bytes)) } catch { /* non-splittable — send as is */ }
    const data = Buffer.from(slim).toString('base64')
    // The model has no clock. Without this it called a two-month-old issue date "a future
    // date" on the first trial run (2026-09-05).
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const text = [
      `Today's date is ${today}.`,
      `File name: ${opts.fileName}`,
      total > sent ? `The document has ${total} pages; you are given the first three and the last two.` : `You are given all ${total || 'the'} pages.`,
      opts.converted ? CONVERTED_NOTE : '',
      '', expectedBlock(opts.expected), '', GUIDE,
    ].join('\n')
    const client = new Anthropic()
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(QualitySchema) },
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
        { type: 'text', text },
      ] }],
    })
    if (!res.parsed_output) return { ok: false, error: 'the checker did not return a valid structured result' }
    return { ok: true, report: res.parsed_output, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

/** Open issues = everything the checker raised; "open" because the next run replaces it. */
export const openCount = (r: QualityReport | null | undefined) => (r?.issues?.length ?? 0)
