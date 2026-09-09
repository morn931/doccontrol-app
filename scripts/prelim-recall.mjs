// RECALL a drawing from "Ready for tender" so it can be corrected and reviewed again.
//
//   node scripts/prelim-recall.mjs <docno> [<docno> ...] [--reason "..."] [--by email] [--write]
//
// What the app's Undo (manage) does, plus what the tender pack needs: the stamped copy in
// COLAB's "Issued for Tender" folder is deleted, every copy of the document in the
// K480SWP-006TenderPack site is deleted, and the prelim row goes back to "in review" with
// its marks, comments, notes and quality results intact — the reviewer opens it as before
// and makes a new call. The recall is written into routing_history and audit_events.
//
// Vossie, 9 Sep 2026: "Is there a means to recall the drawings from the Ready for Tender list
// and re-run the review with the added information?" — 6251-CLAY-0001, 6251-CSEC-0023,
// 6200-WSEC-0002 (a civil drawing changed and the others reference it).
//
// While a document is in an open session and NOT ready_for_tender, the tender-site scripts
// skip it, so a re-run cannot put it back until the reviewer stamps it again.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const REASON = arg('--reason') ?? 'Recalled for correction'
const BY = arg('--by') ?? 'mornec@ppetech.co.za'
const docnos = args.filter(a => /^6105A/i.test(a))
if (!docnos.length) { console.error('usage: node scripts/prelim-recall.mjs <docno...> [--reason "..."] [--by email] [--write]'); process.exit(1) }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async u => { const r = await fetch(G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 100)}`); return r.json() }
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? '').toUpperCase()

// the tender pack site, walked once
const site = await g('/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const drv = (await g(`/sites/${site.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents').id
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const packFiles = []
async function walk(p) { let u = `/drives/${drv}/root:/${enc(p)}:/children?$select=id,name,folder&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(`${p}/${k.name}`); else packFiles.push({ id: k.id, name: k.name, path: `${p}/${k.name}` }) } u = j['@odata.nextLink'] } }
await walk('K480 SWP-006 Power and Balance of Plant')

for (const dn of docnos) {
  const { data: rows } = await sb.from('prelim_document').select('*, prelim_session!inner(id, title, status)').ilike('document_number', `${dn}%`).eq('prelim_session.status', 'open')
  if (!rows?.length) { console.log(`\n${dn}: not in any open session — nothing to recall`); continue }
  for (const d of rows) {
    console.log(`\n${d.document_number} rev ${d.revision ?? '—'}  (${d.prelim_session.title})`)
    console.log(`  call: ${d.routing ?? '—'} by ${d.routing_by_email ?? '—'} at ${d.routing_at ?? '—'} · stamped ${d.tender_stamped_file_name ?? 'no'} · marks ${d.markup_committed_at ? 'yes' : 'no'}`)
    // 1. stamped copy in COLAB
    if (d.tender_stamped_file_url) {
      const it = await fetch(`${G}/shares/${shareId(d.tender_stamped_file_url.split('?')[0])}/driveItem?$select=id,parentReference,name`, { headers: H })
      if (it.ok) { const j = await it.json(); if (WRITE) { const r = await fetch(`${G}/drives/${j.parentReference.driveId}/items/${j.id}`, { method: 'DELETE', headers: H }); console.log(`  COLAB stamped copy deleted (${r.status}) ${j.name}`) } else console.log(`  would delete COLAB stamped copy ${j.name}`) }
      else console.log(`  COLAB stamped copy already gone (${it.status})`)
    }
    // 2. every copy in the tender pack site
    const stem = stemOf(d.document_number)
    for (const f of packFiles.filter(f => stemOf(f.name) === stem)) { if (WRITE) { const r = await fetch(`${G}/drives/${drv}/items/${f.id}`, { method: 'DELETE', headers: H }); console.log(`  tender site copy deleted (${r.status}) ${f.path.slice(41)}`) } else console.log(`  would delete tender site copy ${f.path.slice(41)}`) }
    // 3. the prelim row: back to in-review, history kept
    const history = Array.isArray(d.routing_history) ? d.routing_history : []
    history.push({ at: new Date().toISOString(), event: 'recalled', by: BY, reason: REASON, was: d.routing ? { routing: d.routing, at: d.routing_at, by: d.routing_by_email, to: d.routing_to_email, stamped: d.tender_stamped_file_name } : null })
    if (WRITE) {
      const { error } = await sb.from('prelim_document').update({ routing: null, routing_at: null, routing_by_email: null, routing_to_email: null, routing_to_name: null, routing_mailed_at: null, routing_attached: null, routing_error: null, tender_stamped_at: null, tender_stamped_file_name: null, tender_stamped_file_url: null, tender_stamp_error: null, routing_history: history }).eq('id', d.id)
      console.log(`  prelim row back to in-review: ${error?.message ?? 'ok'}`)
      await sb.from('audit_events').insert({ entity_type: 'prelim_document', entity_id: d.id, event_type: 'prelim_recalled', actor_user_id: null, actor_email: BY, event_data: { sessionId: d.prelim_session.id, document: d.document_number, reason: REASON, was: history[history.length - 1].was } }).then(r => { if (r.error) console.log('  audit:', r.error.message) })
    } else console.log('  would reset the call and write the recall into routing_history')
  }
}
console.log(WRITE ? '\ndone' : '\ndry run — add --write')
