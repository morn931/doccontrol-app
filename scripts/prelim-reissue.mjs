// An engineer re-saved a COLAB source IN PLACE (same file name, same URL) after the room had
// called it Ready for tender — Bennie's four ISCH cable schedules, 9 Sep. The on-load sync
// deliberately ignores an in-place re-save (lib/prelim/sync.ts), so the row keeps its call but
// its working copy, its COLAB stamped copy and the tender-pack copy all still hold the OLD
// content. This brings all three up to the current source without re-opening the review:
//
//   working copy  ← the source as it is now (unstamped)
//   COLAB "Issued for Tender/… - ISSUED FOR TENDER.pdf"  ← re-stamped today, replaced in place
//   tender pack copy (every folder that carries the number)  ← the same stamped bytes
//   row: tender_stamped_at = now, routing stays ready_for_tender, routing_history notes it
//
// A document whose working copy already matches the source is left alone (say --force to
// re-stamp anyway). Sources are never written to.
//   node scripts/prelim-reissue.mjs <docno…> [--by=email] [--note=text] [--force] [--write]
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const { stampIssuedForTender, tenderStampDate } = await import('../lib/prelim/tender-stamp.ts')
const args = process.argv.slice(2)
const WRITE = args.includes('--write'), FORCE = args.includes('--force')
const BY = args.find(a => a.startsWith('--by='))?.slice(5) ?? 'mornec@ppetech.co.za'
const NOTE = args.find(a => a.startsWith('--note='))?.slice(7) ?? 'the engineer re-issued the source in place after the Ready for tender call; working copy, stamped copy and tender-pack copy refreshed from it'
const DOCS = args.filter(a => !a.startsWith('--')).map(s => s.trim().toUpperCase())
if (!DOCS.length) { console.error('usage: node scripts/prelim-reissue.mjs <docno…> [--by=email] [--note=text] [--force] [--write]'); process.exit(1) }
const PACK_SITE = '/sites/K480SWP-006TenderPack', PACK_ROOT = 'K480 SWP-006 Power and Balance of Plant'

const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l.split('?')[0], 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const g = async (u) => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} GET ${u.slice(0, 120)}`); return r.json() }
const bytesByUrl = async (url) => { const r = await fetch(`${G}/shares/${shareId(url)}/driveItem/content`, { headers: H }); if (!r.ok) throw new Error(`${r.status} download ${url.slice(-60)}`); return new Uint8Array(await r.arrayBuffer()) }
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex')
async function putSession(sessionUrl, bytes) {
  const s = await fetch(sessionUrl, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) })
  if (!s.ok) throw new Error(`createUploadSession ${s.status}`)
  const { uploadUrl } = await s.json(); const CH = 10 * 320 * 1024
  for (let off = 0; off < bytes.length; off += CH) { const end = Math.min(off + CH, bytes.length); const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(end - off), 'Content-Range': `bytes ${off}-${end - 1}/${bytes.length}` }, body: bytes.slice(off, end) }); if (!r.ok) throw new Error(`upload chunk ${r.status}`) }
}
const replaceByUrl = (url, bytes) => putSession(`${G}/shares/${shareId(url)}/driveItem/createUploadSession`, bytes)
const replaceById = (drive, id, bytes) => putSession(`${G}/drives/${drive}/items/${id}/createUploadSession`, bytes)
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? s.trim()).toUpperCase()

// the tender pack, walked once: stem → [{drive, id, path, size}]
const packSite = await g(`/sites/ppetechcoza.sharepoint.com:${PACK_SITE}`)
const packDrive = (await g(`/sites/${packSite.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents').id
const pack = new Map()
async function walk(p) { let u = `/drives/${packDrive}/root:/${p.split('/').map(encodeURIComponent).join('/')}:/children?$select=id,name,folder,size&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(`${p}/${k.name}`); else { const s = stemOf(k.name); if (!pack.has(s)) pack.set(s, []); pack.get(s).push({ id: k.id, path: `${p}/${k.name}`.slice(PACK_ROOT.length + 1), size: k.size }) } } u = j['@odata.nextLink'] } }
await walk(PACK_ROOT)

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const date = tenderStampDate(), now = new Date().toISOString()
let done = 0, skipped = 0, failed = 0
for (const dn of DOCS) {
  const { data: rows } = await sb.from('prelim_document').select('id, document_number, routing, source_file_url, source_file_name, working_file_url, tender_stamped_file_url, tender_stamped_file_name, tender_stamped_at, routing_history, prelim_session!inner(title, status)').ilike('document_number', `${dn}%`).eq('prelim_session.status', 'open')
  const d = rows?.[0]
  if (!d) { console.log(`  ?   ${dn}: not in an open session`); failed++; continue }
  if (d.routing !== 'ready_for_tender' || !d.tender_stamped_file_url) { console.log(`  -   ${dn}: call is ${d.routing ?? 'none'}${d.tender_stamped_file_url ? '' : ', no stamped copy'} — nothing to refresh (recall/re-call instead)`); skipped++; continue }
  try {
    const src = await bytesByUrl(d.source_file_url)
    const wc = await bytesByUrl(d.working_file_url).catch(() => null)
    const same = wc && md5(wc) === md5(src)
    const inPack = pack.get(stemOf(d.document_number)) ?? []
    console.log(`\n${d.document_number}  [${d.prelim_session.title.split(' — ')[0]}]  source ${src.length} b · working ${wc ? wc.length + ' b' : 'MISSING'} · ${same ? 'ALREADY CURRENT' : 'source changed'} · stamped ${d.tender_stamped_at?.slice(0, 16)} · pack ${inPack.length ? inPack.map(p => p.path).join(' ; ') : 'NOT IN PACK'}`)
    if (same && !FORCE) { skipped++; continue }
    if (!WRITE) { console.log(`  would refresh working copy, re-stamp COLAB copy (${date}) and replace ${inPack.length} pack file(s)`); done++; continue }
    await replaceByUrl(d.working_file_url, src)
    const { bytes: stamped, pages } = await stampIssuedForTender(src, date)
    await replaceByUrl(d.tender_stamped_file_url, stamped)
    for (const p of inPack) await replaceById(packDrive, p.id, stamped)
    const history = Array.isArray(d.routing_history) ? d.routing_history : []
    history.push({ at: now, event: 'reissued_in_place', by: BY, file: d.source_file_name, file_url: d.source_file_url, note: NOTE, stamped_at: now, pack_files: inPack.map(p => p.path) })
    const { error } = await sb.from('prelim_document').update({ tender_stamped_at: now, tender_stamp_error: null, routing_history: history }).eq('id', d.id)
    if (error) throw new Error(error.message)
    done++; console.log(`  ok  working copy refreshed · COLAB stamped copy re-made (${pages} p, ${date}) · ${inPack.length} pack file(s) replaced`)
  } catch (e) { failed++; console.log(`  FAILED ${dn}: ${String(e.message ?? e).slice(0, 200)}`) }
}
console.log(`\n${WRITE ? 'refreshed' : 'would refresh'} ${done} · unchanged/skipped ${skipped} · failed ${failed}${WRITE ? '' : '\n(dry run — add --write)'}`)
