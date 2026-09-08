// Morné, 2026-09-08: the sessions look at the SWP006 TENDER HANDOVER DOCUMENTS tree and
// nothing else. Every prelim_document whose source is NOT under that tree (rows from the first
// pull out of the old Document Register folders, plus any stray viewer-URL rows) is removed,
// together with its working copy in Internal Reviews and any stamped tender copy it wrote
// outside the tree. Dry run by default.
//   node scripts/prelim-tender-only.mjs           report
//   node scripts/prelim-tender-only.mjs --write   remove
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const TREE = /SWP006(%20| )TENDER(%20| )HANDOVER(%20| )DOCUMENTS/i
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const del = async (url) => { try { const it = await (await fetch(`${G}/shares/${shareId(url)}/driveItem?$select=id,parentReference`, { headers: H })).json(); if (!it?.id) return 'gone'; const r = await fetch(`${G}/drives/${it.parentReference.driveId}/items/${it.id}`, { method: 'DELETE', headers: H }); return r.ok || r.status === 204 ? 'deleted' : `HTTP ${r.status}` } catch (e) { return e.message } }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: docs } = await sb.from('prelim_document').select('id, document_number, source_file_url, working_file_url, tender_stamped_file_url, routing, routing_to_email, markup_committed_at, markup_comments, quality_checked_at, prelim_session!inner(title, status)').eq('prelim_session.status', 'open')
const out = docs.filter(d => !TREE.test(d.source_file_url))
const state = (d) => d.routing ?? ((d.markup_committed_at || (d.markup_comments ?? []).length) ? 'in review' : 'not started')
console.log(`open-session drawings ${docs.length} · NOT under the tender tree: ${out.length}\n`)
const bySess = {}
for (const d of out) (bySess[d.prelim_session.title.replace(/ — .*$/, '')] ??= []).push(d)
for (const [s, xs] of Object.entries(bySess)) {
  console.log(`== ${s} (${xs.length})`)
  for (const d of xs) console.log(`   ${(d.document_number ?? '(no number)').padEnd(28)} ${state(d).padEnd(16)}${d.routing_to_email ? ' → ' + d.routing_to_email : ''}${d.tender_stamped_file_url ? '  · stamped copy outside the tree' : ''}  ${decodeURIComponent(d.source_file_url).replace(/^.*\/COLAB\//, '').replace(/\/[^/]+$/, '').slice(0, 70)}`)
}
if (!WRITE) { console.log('\n(dry run — pass --write to remove these rows, their working copies and any stamped copy outside the tree)'); process.exit(0) }
let n = 0
for (const d of out) {
  const s1 = d.tender_stamped_file_url ? await del(d.tender_stamped_file_url) : '-'
  const s2 = await del(d.working_file_url)
  await sb.from('prelim_quality_run').delete().eq('prelim_document_id', d.id)
  const { error } = await sb.from('prelim_document').delete().eq('id', d.id)
  if (error) { console.log(`   ✗ ${d.document_number}: ${error.message}`); continue }
  n++; console.log(`   removed ${d.document_number ?? d.id}  working copy ${s2} · stamped ${s1}`)
}
console.log(`\nremoved ${n} of ${out.length}`)
