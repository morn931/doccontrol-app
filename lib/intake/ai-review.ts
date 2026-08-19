/**
 * Pre-review AI for vendor document intake.
 *
 * Replaces the old two-step Azure Document-Intelligence-OCR → Azure-OpenAI-classify
 * (la-intake-core) with a single Claude vision pass: Claude reads the actual document
 * (title block, revision block, table of contents, template) and returns a structured
 * result — the classification the old flow produced PLUS Roelien's pre-review checks.
 *
 * SDDR-aware, not SDDR-dependent:
 *   - SDDR row supplied (live awarded contract) → full validation gate (number / title /
 *     revision / status compared against the SDDR; overall PASS | MISMATCH).
 *   - No SDDR (ICTS, light/non-awarded vendors) → extraction-only (classify + TOC/template
 *     checks; overall EXTRACTED). Same module, no special-casing per vendor.
 *
 * The controller's notification renders `overall` + `validation` + `checks.notes`; the AI
 * is advisory — it flags, the controller still decides (reject vs send to reviewers).
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { PDFDocument } from 'pdf-lib'

const MODEL = 'claude-opus-5'
// The title block, revision block and TOC live on the first pages of a document and on the
// (single) sheet of a drawing — sending only these keeps the payload small, fast and cheap
// while covering every check. Large-format drawing title blocks are handled by the render step.
const TITLE_BLOCK_PAGES = 3

/** Expected values from the vendor's SDDR (as held in the app's register). */
export interface SddrExpected {
  document_number: string
  document_title?: string | null
  revision?: string | null
  document_type?: string | null
  document_status?: string | null
  issued_for?: string | null
}

const FieldCheck = z.object({
  field: z.string(),
  expected: z.string(),
  found: z.string(),
  match: z.boolean(),
})

const ReviewSchema = z.object({
  document_kind: z.enum(['drawing', 'document']),
  extracted: z.object({
    document_number: z.string(),
    title: z.string(),
    revision: z.string(),
    status_purpose: z.string(), // IFR / IFC / IFU / For Approval / For Review / etc.
    document_type: z.string(),
    discipline: z.string(),
    topic: z.string(),
    summary: z.string(),
  }),
  checks: z.object({
    has_table_of_contents: z.boolean(),
    toc_required_but_missing: z.boolean(),
    appears_correct_template: z.boolean(),
    // Drawings only (Roelien): title block should read "Title – Cover Page" on the cover and
    // "Title – Table of Contents" on the TOC page. 'not_applicable' for non-drawings.
    cover_page_label: z.enum(['ok', 'missing', 'not_applicable']),
    toc_page_label: z.enum(['ok', 'missing', 'not_applicable']),
    notes: z.string(),
  }),
  // Per-field comparison vs the SDDR — EMPTY in extraction-only mode.
  validation: z.array(FieldCheck),
  overall: z.enum(['PASS', 'MISMATCH', 'EXTRACTED']),
  confidence: z.enum(['high', 'medium', 'low']),
})

export type AiReview = z.infer<typeof ReviewSchema>

export type AiReviewOutcome =
  | { ok: true; review: AiReview; usage: { input_tokens: number; output_tokens: number } }
  | { ok: false; error: string }

const SYSTEM = [
  'You are a document controller\'s pre-review AI for an EPCM project (Reko Diq, client RDMC, contractor PPE Technologies).',
  'You are given the first pages of a vendor engineering document or drawing. Read the ACTUAL content — the title block, the revision/issue block, and any table of contents.',
  'Extract the title-block fields and run the pre-review checks. When expected SDDR values are provided, compare each field against them and decide an overall verdict.',
  'Be tolerant of purely cosmetic differences (extra spaces, a trailing hyphen, "kV" vs "kv", the SDDR title carrying an extra vendor sub-number) — count those as a match and note them. Flag genuine differences (a different revision, a different status/purpose, a different document number or title).',
  'You are advisory: you flag issues for the controller, you never reject. Return only the structured result.',
].join(' ')

function expectedBlock(s: SddrExpected): string {
  return [
    'Expected values from the SDDR:',
    `- document_number: ${s.document_number}`,
    `- title: ${s.document_title ?? '(not in SDDR)'}`,
    `- revision: ${s.revision ?? '(not in SDDR)'}`,
    `- document_type: ${s.document_type ?? '(not in SDDR)'}`,
    `- status/purpose: ${[s.document_status, s.issued_for].filter(Boolean).join(' / ') || '(not in SDDR)'}`,
    '',
    'Populate `validation` with one entry per compared field (document_number, title, revision, status_purpose). Set `overall` to PASS if every compared field matches, otherwise MISMATCH.',
  ].join('\n')
}

const EXTRACT_ONLY =
  'No SDDR is on record for this vendor/document, so this is EXTRACTION ONLY. ' +
  'Still extract every field and run the TOC / template / label checks. Leave `validation` an EMPTY array and set `overall` to EXTRACTED.'

const INSTRUCTIONS = [
  '',
  'Guidance for the checks:',
  '- document_kind: "drawing" for a drawing sheet, "document" for a calc/report/spec/datasheet.',
  '- has_table_of_contents / toc_required_but_missing: a TOC is expected on multi-section documents (not on a single supplier datasheet or a one-sheet drawing).',
  '- For a DRAWING, cover_page_label / toc_page_label check that the title block reads "… – Cover Page" on the cover sheet and "… – Table of Contents" on the contents sheet; use "not_applicable" for non-drawings.',
  '- appears_correct_template: does it use the expected PPE/RDMC vendor title-block template?',
  '- notes: a short controller-facing explanation of anything worth opening the document for.',
].join('\n')

/** Keep only the first N pages so the upload is small; returns the original bytes if already short. */
async function firstPages(bytes: Uint8Array, n: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  if (src.getPageCount() <= n) return bytes
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, Array.from({ length: n }, (_, i) => i))
  pages.forEach((p) => out.addPage(p))
  return out.save()
}

/**
 * Run the pre-review AI on a single vendor document.
 * Requires ANTHROPIC_API_KEY in the environment (or pass an explicit `apiKey`).
 */
export async function reviewVendorDocument(opts: {
  pdfBytes: Uint8Array | Buffer
  fileName: string
  sddr?: SddrExpected | null
  apiKey?: string
}): Promise<AiReviewOutcome> {
  try {
    const bytes = opts.pdfBytes instanceof Uint8Array ? opts.pdfBytes : new Uint8Array(opts.pdfBytes)
    let slim: Uint8Array
    try {
      slim = await firstPages(bytes, TITLE_BLOCK_PAGES)
    } catch {
      slim = bytes // non-splittable PDF — send as-is
    }
    const data = Buffer.from(slim).toString('base64')

    const userText = (opts.sddr ? expectedBlock(opts.sddr) : EXTRACT_ONLY) + '\n' + INSTRUCTIONS

    const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : undefined)
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: 'medium', format: zodOutputFormat(ReviewSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
            { type: 'text', text: `File name: ${opts.fileName}\n\n${userText}` },
          ],
        },
      ],
    })

    if (!res.parsed_output) return { ok: false, error: 'AI did not return a valid structured result' }
    return {
      ok: true,
      review: res.parsed_output,
      usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}
