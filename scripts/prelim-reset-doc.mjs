// Reset ONE prelim drawing to freshly-pulled: working copy re-copied from the COLAB source
// (wiping flattened marks), layer/comments/notes/outcome/routing/return cleared, any stamped
// tender copy removed. Quality results are kept (they are about the source).
//   node scripts/prelim-reset-doc.mjs <document number>            dry run
//   node scripts/prelim-reset-doc.mjs <document number> --write
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const docno = process.argv.find(a => /^6105A/i.test(a)); if (!docno) { console.error('usage: node scripts/prelim-reset-doc.mjs <docno> [--write]'); process.exit(1) }
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: docs } = await sb.from('prelim_document').select('*, prelim_session!inner(title)').ilike('document_number', docno)
if (!docs?.length) { console.log('not found'); process.exit(1) }
for (const d of docs) {
  console.log(`\n${d.document_number}  ${d.prelim_session.title}`)
  console.log(`  layer ${d.markup_layer ? 'yes' : 'no'} · comments ${Array.isArray(d.markup_comments) ? d.markup_comments.length : 0} · marks saved ${d.markup_committed_at ?? '—'} · note "${d.outcome_note ?? ''}" · outcome ${d.outcome} · routing ${d.routing ?? '—'} → ${d.routing_to_email ?? '—'} · returned ${d.returned_at ?? '—'} · stamped ${d.tender_stamped_file_url ? 'yes' : 'no'} · history ${Array.isArray(d.routing_history) ? d.routing_history.length : 0}`)
  if (!WRITE) continue
  // 1. working copy ← source (fresh bytes over the same item)
  const src = await (await fetch(`${G}/shares/${shareId(d.source_file_url)}/driveItem?$select=id,name,parentReference`, { headers: H })).json()
  const isPdf = /\.pdf$/i.test(src.name)
  const bytes = await (await fetch(`${G}/drives/${src.parentReference.driveId}/items/${src.id}/content${isPdf ? '' : '?format=pdf'}`, { headers: H })).arrayBuffer()
  const wc = await (await fetch(`${G}/shares/${shareId(d.working_file_url)}/driveItem?$select=id,parentReference`, { headers: H })).json()
  if (wc?.id) {
    const up = await fetch(`${G}/drives/${wc.parentReference.driveId}/items/${wc.id}/content`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/pdf' }, body: bytes })
    if (!up.ok) throw new Error(`working copy PUT ${up.status}: ${(await up.text()).slice(0, 200)}`)
    console.log(`  working copy replaced from source (${(bytes.byteLength / 1024).toFixed(0)} KB)`)
  } else {
    // The working copy is GONE (9 Sep 2026: 6292-ISCH-0001 — the app showed "Could not load the
    // document from SharePoint" while the source sat in COLAB). Re-create it at the recorded path.
    const u = new URL(d.working_file_url); const rel = decodeURIComponent(u.pathname).replace(/^\/sites\/DocumentControl\/Internal Reviews\//, '')
    const site = await (await fetch(`${G}/sites/ppetechcoza.sharepoint.com:/sites/DocumentControl`, { headers: H })).json()
    const drv = (await (await fetch(`${G}/sites/${site.id}/drives?$select=id,name`, { headers: H })).json()).value.find(x => x.name === 'Internal Reviews')
    const enc = p => p.split('/').map(encodeURIComponent).join('/')
    const s = await fetch(`${G}/drives/${drv.id}/root:/${enc(rel)}:/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) })
    if (!s.ok) throw new Error(`working copy upload session ${s.status}: ${(await s.text()).slice(0, 200)}`)
    const { uploadUrl } = await s.json()
    const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(bytes.byteLength), 'Content-Range': `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}` }, body: bytes })
    if (!r.ok) throw new Error(`working copy upload ${r.status}`)
    console.log(`  working copy was MISSING — re-created from source (${(bytes.byteLength / 1024).toFixed(0)} KB)`)
  }
  // 2. stamped tender copy, if any
  if (d.tender_stamped_file_url) {
    const it = await (await fetch(`${G}/shares/${shareId(d.tender_stamped_file_url)}/driveItem?$select=id,parentReference`, { headers: H })).json()
    if (it?.id) { const del = await fetch(`${G}/drives/${it.parentReference.driveId}/items/${it.id}`, { method: 'DELETE', headers: H }); console.log(`  stamped copy deleted (${del.status})`) }
  }
  // 3. the row
  const { error } = await sb.from('prelim_document').update({
    markup_layer: null, markup_comments: null, markup_committed_at: null,
    outcome: 'pending', outcome_note: null, outcome_by_email: null, outcome_at: null, rework_to_email: null, rework_sent_at: null,
    routing: null, routing_at: null, routing_by_email: null, routing_to_email: null, routing_to_name: null, routing_mailed_at: null, routing_attached: null, routing_error: null,
    returned_at: null, returned_by_email: null, returned_from: null, returned_file_name: null, returned_file_url: null, prior_working_file_url: null, routing_history: [],
    tender_stamped_at: null, tender_stamped_file_name: null, tender_stamped_file_url: null, tender_stamp_error: null,
  }).eq('id', d.id)
  if (error) throw error
  await sb.from('audit_events').insert({ entity_type: 'prelim_document', entity_id: d.id, event_type: 'prelim_reset', actor_email: 'mornec@ppetech.co.za', event_data: { reason: 'test drawing reset to fresh', document: d.document_number } }).then(() => null, () => null)
  console.log('  row reset')
}
if (!WRITE) console.log('\n(dry run — pass --write)')
