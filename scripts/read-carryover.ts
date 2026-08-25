/**
 * Read every carry-over document with Claude and fill the ai_* columns.
 *
 * WHY A SEPARATE MODULE FROM lib/intake/ai-review.ts. That one is live vendor intake and
 * answers a different question — "does this match the SDDR?". This job needs something the
 * vendor flow never asks: **is the document in a project title block at all?** Half of what
 * this exercise is fixing is documents that went out to tender with no border and no
 * number, and a controller cannot see that from a register row. Rather than widen the
 * production schema and risk the vendor gate, this mirrors its approach with its own.
 *
 * ADVISORY, NEVER AUTHORITATIVE. Everything lands in ai_* columns. The decision columns
 * stay empty for document control — an extracted document number is exactly the thing
 * nobody should accept unseen.
 *
 * Resumable: rows already read are skipped, failures record ai_error rather than going
 * quietly blank, so "could not read this one" is visible in the register.
 *
 *   npx tsx scripts/read-carryover.ts                # read everything unread
 *   npx tsx scripts/read-carryover.ts --limit 5      # try a handful first
 *   npx tsx scripts/read-carryover.ts --retry        # re-attempt previous failures
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { PDFDocument } from 'pdf-lib'
import { createClient } from '@supabase/supabase-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  const k = t.slice(0, i).trim()
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n|\\r/g, '').trim()
  if (!(k in process.env)) process.env[k] = v
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const OWNER = 'mornec@ppetech.co.za'
const FOLDER = 'Company Docs/Jarrod add to CDDL K124'
const MODEL = 'claude-opus-5'
const TITLE_BLOCK_PAGES = 3
const CONCURRENCY = 4

// Office formats Graph can render to PDF for us. .xlsm (macro) is deliberately absent —
// Graph refuses it, and a row that says so is better than one that silently never reads.
const OFFICE = new Set(['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'])
const READABLE = new Set(['pdf', ...OFFICE])

const Schema = z.object({
  /** Is this document inside a project title block / drawing border at all? The whole
   *  point of the exercise — a tender document with no border is the defect being fixed. */
  in_project_border: z.boolean(),
  border_owner: z.string(),      // e.g. "RDMC", "PPE", "Caterpillar", "none"
  document_number: z.string(),   // as PRINTED in the border — may differ from the filename
  title: z.string(),
  revision: z.string(),
  status_purpose: z.string(),    // IFR / IFC / IFU / For Approval / none
  document_type: z.string(),
  discipline: z.string(),
  originator: z.string(),        // who produced it — PPE, or the vendor's name
  kind: z.enum(['drawing', 'document']),
  topic: z.string(),
  summary: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
})

const SYSTEM = [
  'You read engineering tender documents and report exactly what is on the page.',
  'These documents were issued for tender in a hurry: many have no project title block, no',
  'document number and no revision. That is expected and is what the reader exists to find.',
  'NEVER infer a document number from the file name — report only what is PRINTED in the',
  'document itself. If a field is not present, return an empty string rather than a guess.',
  'in_project_border means the page carries a formal title block / drawing border. A plain',
  'vendor datasheet or a bare Word document is NOT in a project border.',
  'originator is whoever produced the document — PPE Technologies, or the vendor by name.',
].join(' ')

async function firstPages(bytes: Uint8Array, n: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  if (src.getPageCount() <= n) return bytes
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, Array.from({ length: n }, (_v, i) => i))
  pages.forEach((p) => out.addPage(p))
  return out.save()
}

let token: { v: string; exp: number } | null = null
async function graphToken(): Promise<string> {
  if (token && Date.now() < token.exp) return token.v
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error(`Graph token: ${JSON.stringify(j).slice(0, 200)}`)
  token = { v: j.access_token, exp: Date.now() + 45 * 60 * 1000 }
  return token.v
}

/** Fetch a document as PDF bytes — converting Office formats through Graph on the way. */
async function fetchPdf(sourcePath: string): Promise<Uint8Array> {
  const ext = (sourcePath.split('.').pop() || '').toLowerCase()
  if (!READABLE.has(ext)) throw new Error(`not a readable format (.${ext})`)
  const enc = `${FOLDER}/${sourcePath}`.split('/').map(encodeURIComponent).join('/')
  const base = `https://graph.microsoft.com/v1.0/users/${OWNER}/drive/root:/${enc}:/content`
  const url = OFFICE.has(ext) ? `${base}?format=pdf` : base
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await graphToken()}` } })
  if (!res.ok) throw new Error(`Graph ${res.status} fetching the file${OFFICE.has(ext) ? ' (PDF conversion)' : ''}`)
  return new Uint8Array(await res.arrayBuffer())
}

type Row = {
  id: string
  temp_ref: string
  source_path: string
  /** set on K038 rows — the file is on SharePoint, not in the OneDrive transfer folder */
  file_link: string | null
}

/** Bytes for a SharePoint-hosted document, resolved through CoreDocs' own resolver so a
 *  renamed or moved file still opens. */
async function fetchSharePointPdf(fileLink: string, ref: string): Promise<{ bytes: Uint8Array; name: string }> {
  const { resolveOpenUrl } = await import('../lib/services/sp-resolve')
  const { resolveDriveItemByUrl, getDriveItemContentBytes } = await import('../lib/services/graph')
  const live = await resolveOpenUrl(fileLink, ref).catch(() => null)
  const item = await resolveDriveItemByUrl(live || fileLink)
  if (!item?.driveId) throw new Error('file could not be located on SharePoint')
  const ext = (item.name.split('.').pop() || '').toLowerCase()
  const wantPdf = OFFICE.has(ext)
  if (!wantPdf && ext !== 'pdf') throw new Error(`not a readable format (.${ext})`)
  const bytes = await getDriveItemContentBytes(item.driveId, item.id, wantPdf ? 'pdf' : undefined)
  return { bytes: new Uint8Array(bytes), name: item.name }
}

async function readOne(client: Anthropic, row: Row) {
  // Two sources, two locations — the reader should not care which, any more than the
  // register does.
  let name: string
  let bytes: Uint8Array
  if (row.file_link) {
    const got = await fetchSharePointPdf(row.file_link, row.temp_ref)
    bytes = got.bytes
    name = got.name
  } else {
    name = row.source_path.split('/').pop()!
    bytes = await fetchPdf(row.source_path)
  }
  try {
    bytes = await firstPages(bytes, TITLE_BLOCK_PAGES)
  } catch {
    /* unsplittable PDF — send it whole rather than failing the row */
  }
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(Schema) },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } },
        { type: 'text', text: `File name: ${name}\n\nRead this document and report what is printed on it.` },
      ],
    }],
  })
  if (!res.parsed_output) throw new Error('no structured result returned')
  return res.parsed_output
}

async function main() {
  const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0
  const retry = process.argv.includes('--retry')

  let q = db.from('cddl_carryover').select('id,temp_ref,source_path,file_link').order('temp_ref')
  q = retry ? q.not('ai_error', 'is', null) : q.is('ai_read_at', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const all = (limit ? (data ?? []).slice(0, limit) : (data ?? [])) as Row[]
  // Rows already known to have no file are skipped rather than retried into the same
  // failure — their ai_error already says why.
  const rows = all.filter((r) => r.file_link || r.source_path.includes('/'))
  const skipped = all.length - rows.length
  if (skipped) console.log(`(skipping ${skipped} row(s) with no file to open)\n`)
  console.log(`${rows.length} document(s) to read${retry ? ' (retrying previous failures)' : ''}\n`)
  if (!rows.length) return

  const client = new Anthropic()
  let ok = 0, failed = 0, done = 0
  let inTok = 0, outTok = 0

  const worker = async () => {
    for (;;) {
      const row = rows.shift()
      if (!row) return
      const patch: Record<string, unknown> = { ai_read_at: new Date().toISOString(), ai_error: null }
      let label: string
      try {
        const r = await readOne(client, row)
        Object.assign(patch, {
          ai_docno: r.document_number || null,
          ai_title: r.title || null,
          ai_revision: r.revision || null,
          ai_status: r.status_purpose || null,
          ai_discipline: r.discipline || null,
          ai_doc_type: r.document_type || null,
          ai_topic: r.topic || null,
          ai_summary: r.summary || null,
          ai_kind: r.kind,
          ai_has_border: r.in_project_border,
          ai_confidence: r.confidence,
        })
        // border_owner and originator are useful context; keep them with the summary
        // rather than adding columns for a temporary exercise.
        patch.ai_summary = [r.summary, r.originator ? `Originator: ${r.originator}.` : '',
                            r.border_owner ? `Border: ${r.border_owner}.` : ''].filter(Boolean).join(' ')
        ok++
        label = `${r.in_project_border ? 'border' : 'NO border'} · ${r.document_number || 'no number'} · ${(r.title || '').slice(0, 40)}`
      } catch (e) {
        patch.ai_error = (e as Error).message?.slice(0, 300) ?? String(e)
        failed++
        label = `FAILED — ${patch.ai_error}`
      }
      const { error: upErr } = await db.from('cddl_carryover').update(patch).eq('id', row.id)
      if (upErr) console.log(`  ${row.temp_ref} write failed: ${upErr.message}`)
      done++
      console.log(`  [${String(done).padStart(3)}] ${row.temp_ref}  ${label}`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`\nread ${ok}, failed ${failed}`)
  if (inTok || outTok) console.log(`tokens: ${inTok} in / ${outTok} out`)

  const { count: withBorder } = await db.from('cddl_carryover')
    .select('id', { count: 'exact', head: true }).eq('ai_has_border', true)
  const { count: noBorder } = await db.from('cddl_carryover')
    .select('id', { count: 'exact', head: true }).eq('ai_has_border', false)
  const { count: withNo } = await db.from('cddl_carryover')
    .select('id', { count: 'exact', head: true }).not('ai_docno', 'is', null)
  console.log(`\nregister now: ${withBorder} in a project border, ${noBorder} not, ${withNo} with a number printed on the document`)
}

main().catch((e) => { console.error(e); process.exit(1) })
