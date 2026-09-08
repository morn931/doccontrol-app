// Remove session rows that are STAMPED TENDER COPIES pulled back in by the tree walk on
// 8 Sep (source inside an "Issued for Tender" folder, or name ending " - ISSUED FOR TENDER.pdf"),
// with their working copies and quality runs. The stamped copies in COLAB are left alone —
// they are the pack. Dry run by default; --write to remove.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const del = async (url) => { try { const it = await (await fetch(`${G}/shares/${shareId(url)}/driveItem?$select=id,parentReference`, { headers: H })).json(); if (!it?.id) return 'gone'; const r = await fetch(`${G}/drives/${it.parentReference.driveId}/items/${it.id}`, { method: 'DELETE', headers: H }); return r.ok || r.status === 204 ? 'deleted' : `HTTP ${r.status}` } catch (e) { return e.message } }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: docs } = await sb.from('prelim_document').select('id, source_file_name, source_file_url, working_file_url, routing, markup_committed_at, markup_comments, prelim_session!inner(title, status)').eq('prelim_session.status', 'open')
const out = docs.filter(d => / - ISSUED FOR TENDER\.pdf$/i.test(d.source_file_name) || /\/Issued(%20| )for(%20| )Tender\//i.test(d.source_file_url))
console.log(`stamped-copy rows in open sessions: ${out.length}`)
for (const d of out) console.log(`   ${d.prelim_session.title.replace(/ — .*$/, '').padEnd(28)} ${d.source_file_name}${d.routing || d.markup_committed_at || (d.markup_comments ?? []).length ? '  ⚠ has work on it' : ''}`)
if (!WRITE) { console.log('\n(dry run — pass --write)'); process.exit(0) }
let n = 0
for (const d of out) {
  const w = await del(d.working_file_url)
  await sb.from('prelim_quality_run').delete().eq('prelim_document_id', d.id)
  const { error } = await sb.from('prelim_document').delete().eq('id', d.id)
  if (error) { console.log(`   ✗ ${d.source_file_name}: ${error.message}`); continue }
  n++; console.log(`   removed ${d.source_file_name} · working copy ${w}`)
}
console.log(`removed ${n} of ${out.length}`)
