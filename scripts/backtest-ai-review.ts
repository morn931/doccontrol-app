/**
 * Backtest the pre-review AI (lib/intake/ai-review) over real documents already in the app.
 *
 * Validates the SDDR gate offline, at scale, with zero live-intake risk: pulls documents that
 * have an SDDR row (live awarded contracts, e.g. E102), runs the module, and prints the AI's
 * verdict next to the known revision. Also runs a couple in extraction-only mode (no SDDR) to
 * exercise the ICTS/light-vendor path.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... PKG=E102 N=5 npx tsx scripts/backtest-ai-review.ts
 */
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewVendorDocument, type SddrExpected } from '../lib/intake/ai-review'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clean = (s: string) => (s || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '').trim()
const env: Record<string, string> = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]
}
const SB = (clean(env.NEXT_PUBLIC_SUPABASE_URL).match(/https?:\/\/[a-z0-9.-]+/i) || [''])[0]
const SKEY = clean(env.SUPABASE_SERVICE_ROLE_KEY).replace(/[^A-Za-z0-9._-]/g, '')
const TEN = clean(env.MICROSOFT_TENANT_ID), CID = clean(env.MICROSOFT_CLIENT_ID), CSEC = clean(env.MICROSOFT_CLIENT_SECRET)
const PKG = process.env.PKG || 'E102'
const N = Number(process.env.N || 5)

function req(method: string, url: string, headers: any, body?: string, follow = true): Promise<{ s: number; buf: Buffer }> {
  return new Promise((res, rej) => {
    const u = new URL(url); const H = { ...(headers || {}) }; if (body) H['Content-Length'] = Buffer.byteLength(body)
    const r = https.request({ method, host: u.hostname, path: u.pathname + u.search, family: 4, headers: H }, (x) => {
      if (follow && [301, 302, 303, 307, 308].includes(x.statusCode!) && x.headers.location) { x.resume(); return res(req('GET', x.headers.location, {}, undefined, false)) }
      const c: Buffer[] = []; x.on('data', (d) => c.push(d)); x.on('end', () => res({ s: x.statusCode!, buf: Buffer.concat(c) }))
    })
    r.on('error', rej); if (body) r.write(body); r.end()
  })
}
const sb = (p: string) => req('GET', `${SB}/rest/v1/${p}`, { apikey: SKEY, Authorization: 'Bearer ' + SKEY })
const j = (r: { buf: Buffer }) => JSON.parse(r.buf.toString())

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY'); process.exit(1) }
  const graphTok = j(await req('POST', `https://login.microsoftonline.com/${TEN}/oauth2/v2.0/token`, { 'Content-Type': 'application/x-www-form-urlencoded' },
    new URLSearchParams({ grant_type: 'client_credentials', client_id: CID, client_secret: CSEC, scope: 'https://graph.microsoft.com/.default' }).toString())).access_token

  const dvs = j(await sb(`document_versions?file_name=ilike.*${PKG}*&central_file_url=not.is.null&select=file_name,central_file_url,revision&limit=${N}`))
  console.log(`Backtesting ${dvs.length} ${PKG} documents through lib/intake/ai-review\n${'='.repeat(70)}`)

  let idx = 0
  for (const d of dvs) {
    idx++
    const base = d.file_name.replace(/\.[^.]+$/, '').replace(/_[A-Z0-9]+$/i, '')
    let sddr: SddrExpected | null = null
    for (let i = 0; i < 5 && !sddr; i++) { try { sddr = j(await sb(`mddr_entries?document_number=eq.${encodeURIComponent(base)}&select=document_number,document_title,revision,document_type,document_status,issued_for`))[0] || null } catch { await new Promise((x) => setTimeout(x, 1200)) } }
    // Force extraction-only for the last item to demo the ICTS/no-SDDR path
    const forceExtractOnly = idx === dvs.length
    const share = 'u!' + Buffer.from(d.central_file_url).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const pdf = await req('GET', `https://graph.microsoft.com/v1.0/shares/${share}/driveItem/content`, { Authorization: 'Bearer ' + graphTok })
    if (pdf.buf.length < 1000) { console.log(`\n[${idx}] ${d.file_name}: download failed`); continue }

    const t0 = Date.now()
    const out = await reviewVendorDocument({ pdfBytes: pdf.buf, fileName: d.file_name, sddr: forceExtractOnly ? null : sddr })
    const ms = Date.now() - t0
    console.log(`\n[${idx}] ${d.file_name}  (file rev ${d.revision}${forceExtractOnly ? ', forced extraction-only' : sddr ? `, SDDR rev ${sddr.revision}` : ', no SDDR'})`)
    if (!out.ok) { console.log('   ERROR:', out.error); continue }
    const r = out.review
    console.log(`   kind=${r.document_kind}  extracted: no=${r.extracted.document_number} rev=${r.extracted.revision} status=${r.extracted.status_purpose} type=${r.extracted.document_type}`)
    console.log(`   checks: TOC=${r.checks.has_table_of_contents} template=${r.checks.appears_correct_template} coverLbl=${r.checks.cover_page_label} tocLbl=${r.checks.toc_page_label}`)
    if (r.validation.length) for (const v of r.validation) console.log(`     ${v.match ? '✓' : '✗'} ${v.field}: expected "${v.expected}" | found "${v.found}"`)
    console.log(`   >> OVERALL: ${r.overall}  (confidence ${r.confidence}, ${ms}ms, in ${out.usage.input_tokens}/out ${out.usage.output_tokens} tok)`)
    if (r.checks.notes) console.log(`   note: ${r.checks.notes.slice(0, 220)}`)
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
