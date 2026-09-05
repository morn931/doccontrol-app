// Run the prelim quality checker over a few real COLAB drawings and PRINT what it says —
// the standing rule: a check is not shipped until its findings have been read against the
// real documents. usage: node scripts/_quality-trial.mjs [n]
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const { checkDocumentQuality } = await import('../lib/prelim/quality-check.ts')
const N = Number(process.argv[2] ?? 5)
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: docs } = await sb.from('prelim_document').select('id, document_number, revision, title, discipline, document_type, source_file_name, source_file_url, cddl_doc_id').order('created_at').limit(N)
for (const d of docs ?? []) {
  const item = await (await fetch(`${G}/shares/${shareId(d.source_file_url)}/driveItem`, { headers: H })).json()
  const isPdf = /\.pdf$/i.test(item.name)
  const bytes = await (await fetch(`${G}/drives/${item.parentReference.driveId}/items/${item.id}/content${isPdf ? '' : '?format=pdf'}`, { headers: H })).arrayBuffer()
  let expected = { document_number: d.document_number, title: d.title, revision: d.revision, discipline: d.discipline, document_type: d.document_type }
  if (d.cddl_doc_id) { const { data: c } = await sb.from('cddl_doc').select('docno, title, revision, discipline, doc_type').eq('id', d.cddl_doc_id).maybeSingle(); if (c) expected = { document_number: c.docno, title: c.title ?? d.title, revision: c.revision ?? d.revision, discipline: c.discipline, document_type: c.doc_type } }
  const t0 = Date.now()
  const out = await checkDocumentQuality({ pdfBytes: Buffer.from(bytes), fileName: item.name, expected, converted: !isPdf })
  console.log(`\n══ ${d.document_number}  ${item.name}  (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  console.log(`   register: rev ${expected.revision ?? '-'} · "${(expected.title ?? '').slice(0, 70)}"`)
  if (!out.ok) { console.log('   ✗', out.error); continue }
  const r = out.report
  console.log(`   read: ${r.document_kind}, ${r.pages_read} pages · title block ${r.title_block.present ? 'present' : 'MISSING'}, template ${r.title_block.template_ok ? 'ok' : 'NOT ok'} · no "${r.title_block.document_number}" rev "${r.title_block.revision}" status "${r.title_block.status_purpose}" · "${r.title_block.title.slice(0, 60)}"`)
  console.log(`   overall ${r.overall} (${r.confidence}) · ${r.issues.length} issues · tokens ${out.usage.input_tokens}/${out.usage.output_tokens}`)
  for (const i of r.issues) console.log(`     [${i.severity}] ${i.page != null ? `p${i.page} ` : ''}${i.code}: ${i.description}\n            fix: ${i.fix}`)
  if (r.notes) console.log(`   notes: ${r.notes.slice(0, 300)}`)
}
