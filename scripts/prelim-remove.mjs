// REMOVE a document from the prelim review altogether — for a drawing saved under the WRONG
// NUMBER, superseded by a differently-numbered one (not for a drawing that needs correction:
// that is prelim-recall.mjs).
//
//   node scripts/prelim-remove.mjs <docno> [<docno> ...] [--reason "..."] [--by email] [--colab] [--write]
//
// What it does, per document, in every OPEN session that holds it:
//   • deletes the working copy in Internal Reviews (the file the app opens)
//   • deletes the stamped "Issued for Tender" copy in COLAB, if one was made
//   • deletes every copy in the K480SWP-006TenderPack site, if any
//   • with --colab, ALSO deletes the source file from the COLAB handover tree — otherwise
//     the on-load sync re-pulls the wrong-numbered file into the session next time
//   • deletes the prelim row, and writes what was removed (with its routing history and
//     comments) to audit_events as prelim_removed
//
// 9 Sep 2026: 6286-PGAD-0002 (should have been -0001, Vossie) and 6212-SGAD-0001/-0002
// (WBS re-assigned to 6264 by Johan, Miemie).
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const args = process.argv.slice(2)
const WRITE = args.includes('--write'), COLAB = args.includes('--colab')
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const REASON = arg('--reason') ?? 'Removed — superseded'
const BY = arg('--by') ?? 'mornec@ppetech.co.za'
const docnos = args.filter(a => /^6105A/i.test(a))
// --file=<source file name> (repeatable): only the rows carrying that source file — for a SHEET of
// a document whose number is shared with the surviving pack (PPFD-0001 Sh1of2/Sh2of2, 10 Sep)
const FILES = args.filter(a => a.startsWith('--file=')).map(a => a.slice(7).toLowerCase())
if (!docnos.length) { console.error('usage: node scripts/prelim-remove.mjs <docno...> [--reason "..."] [--by email] [--colab] [--write]'); process.exit(1) }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async u => { const r = await fetch(G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 100)}`); return r.json() }
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? '').toUpperCase()
async function delByUrl(label, url) {
  if (!url) return
  const it = await fetch(`${G}/shares/${shareId(url.split('?')[0])}/driveItem?$select=id,parentReference,name`, { headers: H })
  if (!it.ok) { console.log(`  ${label}: already gone (${it.status})`); return }
  const j = await it.json()
  if (WRITE) { const r = await fetch(`${G}/drives/${j.parentReference.driveId}/items/${j.id}`, { method: 'DELETE', headers: H }); console.log(`  ${label}: deleted (${r.status}) ${j.name}`) } else console.log(`  would delete ${label}: ${j.name}`)
}
// the tender pack site, walked once
const site = await g('/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const drv = (await g(`/sites/${site.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents').id
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const packFiles = []
async function walk(p) { let u = `/drives/${drv}/root:/${enc(p)}:/children?$select=id,name,folder&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(`${p}/${k.name}`); else packFiles.push({ id: k.id, name: k.name, path: `${p}/${k.name}` }) } u = j['@odata.nextLink'] } }
await walk('K480 SWP-006 Power and Balance of Plant')

for (const dn of docnos) {
  const { data: rows0 } = await sb.from('prelim_document').select('*, prelim_session!inner(id, title, status)').ilike('document_number', `${dn}%`).eq('prelim_session.status', 'open')
  const rows = (rows0 ?? []).filter(r => !FILES.length || FILES.includes(String(r.source_file_name).toLowerCase()))
  if (!rows?.length) { console.log(`\n${dn}: not in any open session`); continue }
  for (const d of rows) {
    console.log(`\n${d.document_number} rev ${d.revision ?? '—'}  (${d.prelim_session.title})`)
    console.log(`  call: ${d.routing ?? '—'} → ${d.routing_to_email ?? '—'} at ${d.routing_at ?? '—'} · stamped ${d.tender_stamped_file_name ?? 'no'} · marks ${d.markup_committed_at ? 'yes' : 'no'}`)
    await delByUrl('working copy', d.working_file_url)
    await delByUrl('stamped copy', d.tender_stamped_file_url)
    if (COLAB) await delByUrl('COLAB source', d.source_file_url); else console.log(`  COLAB source left in place (add --colab to remove it; the sync will otherwise re-pull it)`)
    const stem = stemOf(d.document_number)
    // a row that was never stamped owns no copy in the pack — the copy there belongs to a
    // surviving row with the same number (the combined PPFD pack, 10 Sep); leave it alone
    for (const f of d.tender_stamped_file_url ? packFiles.filter(f => stemOf(f.name) === stem) : []) { if (WRITE) { const r = await fetch(`${G}/drives/${drv}/items/${f.id}`, { method: 'DELETE', headers: H }); console.log(`  tender site copy deleted (${r.status}) ${f.path.slice(41)}`) } else console.log(`  would delete tender site copy ${f.path.slice(41)}`) }
    if (WRITE) {
      await sb.from('audit_events').insert({ entity_type: 'prelim_document', entity_id: d.id, event_type: 'prelim_removed', actor_user_id: null, actor_email: BY, event_data: { sessionId: d.prelim_session.id, document: d.document_number, reason: REASON, routing: d.routing, routing_to: d.routing_to_email, routing_at: d.routing_at, routing_history: d.routing_history ?? null, comments: d.markup_comments ?? null, colab_source_removed: COLAB } }).then(r => { if (r.error) console.log('  audit:', r.error.message) })
      const { error } = await sb.from('prelim_document').delete().eq('id', d.id); console.log(`  prelim row deleted: ${error?.message ?? 'ok'}`)
    } else console.log('  would delete the prelim row and write the removal to audit_events')
  }
}
console.log(WRITE ? '\ndone' : '\ndry run — add --write')
