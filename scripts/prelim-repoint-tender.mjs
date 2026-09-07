// Point the prelim sessions at Vossie's new COLAB tree (email "K480 SWP 006 - Tender Handover
// Documents", 2026-09-07): COLAB/SWP006 TENDER HANDOVER DOCUMENTS/<n. Substation>/<discipline>.
//
//   1. each open substation session's source_folder → its new substation folder
//   2. a fifth session for "1. Substations BOP Project Site Wide" (standards & specs)
//   3. every drawing already pulled is RE-POINTED to the same-named file in the new tree
//      when it has been moved there (keeps the quality check it already has); the ones
//      not moved yet are reported
//   4. every file in the new tree that is in no session yet is pulled, the way the pull
//      route does it (working PDF copy → Internal Reviews/Prelim/<session>/, row + CDDL match)
// Idempotent — run it again tomorrow after the engineers have moved their files.
//
//   node scripts/prelim-repoint-tender.mjs           dry run
//   node scripts/prelim-repoint-tender.mjs --write
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const retry = async (fn, n = 5) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))) } } }
const tok = (await retry(async () => (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json())).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const gget = async (u) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 80)}`); return r.json() })
const siteId = async (url) => { const u = new URL(url); return (await gget(`/sites/${u.hostname}:${u.pathname}`)).id }
const driveId = async (sid, name) => { const ds = (await gget(`/sites/${sid}/drives?$select=id,name`)).value ?? []; const d = ds.find(x => x.name === name); if (!d) throw new Error(`library "${name}" not found`); return d.id }
const enc = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')

const SOURCE_SITE = process.env.PRELIM_SOURCE_SITE_URL || 'https://ppetechcoza.sharepoint.com/sites/K138-BalanceofPlant'
const SOURCE_LIB  = process.env.PRELIM_SOURCE_LIBRARY || 'COLAB'
const DC_SITE     = process.env.INTERNAL_REVIEW_SITE_URL || process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL
const IR_LIB      = process.env.INTERNAL_REVIEW_LIBRARY || 'Internal Reviews'
const PRELIM_FOLDER = process.env.PRELIM_FOLDER || 'Prelim'
const BY = 'mornec@ppetech.co.za'
const ROOT = 'SWP006 TENDER HANDOVER DOCUMENTS'

// our session (by current area) → Vossie's substation folder
const MAP = [
  { area: 'Main Consumer Substation', folder: '2. Plant Main Substation' },
  { area: 'Mining Substation',        folder: '3. Mining Substation' },
  { area: 'Main Intake Substation',   folder: '4. Power Station Substation' },
  { area: 'Solar PV Substation',      folder: '5. Solar PV Substation' },
]
const SITEWIDE = { area: 'Site Wide (standards & specs)', folder: '1. Substations BOP Project Site Wide', title: 'Site Wide standards & specs — SWP006 tender handover (Sep 2026)' }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const srcSite = await siteId(SOURCE_SITE), srcDrive = await driveId(srcSite, SOURCE_LIB)

// ── the new tree ───────────────────────────────────────────────────────────────────
const files = []
const walk = async (path, depth) => {
  let u = `/drives/${srcDrive}/root:/${enc(path)}:/children?$select=id,name,folder,file,size,webUrl,lastModifiedDateTime&$top=999`
  while (u) {
    const j = await gget(u)
    for (const c of j.value ?? []) { const p = `${path}/${c.name}`; if (c.folder) { if (depth < 6) await walk(p, depth + 1) } else files.push({ id: c.id, name: c.name, path: p, top: p.split('/')[1], size: c.size, webUrl: c.webUrl, modified: c.lastModifiedDateTime, hash: c.file?.hashes?.quickXorHash ?? null }) }
    u = j['@odata.nextLink']
  }
}
await walk(ROOT, 0)
console.log(`${ROOT}: ${files.length} files`)
const tally = (xs, f) => Object.entries(xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).sort()
for (const [k, v] of tally(files, f => f.top)) console.log(`   ${v.toString().padStart(3)}  ${k}`)

// ── sessions ────────────────────────────────────────────────────────────────────────
const { data: sessions } = await sb.from('prelim_session').select('id, title, area, source_folder, status').eq('status', 'open')
const plan = []
for (const m of MAP) {
  const s = (sessions ?? []).find(x => x.area === m.area)
  if (!s) { console.log(`⚠ no open session for ${m.area}`); continue }
  plan.push({ session: s, folder: `${ROOT}/${m.folder}`, top: m.folder })
}
let sitewide = (sessions ?? []).find(x => x.source_folder === `${ROOT}/${SITEWIDE.folder}`)
console.log('\nsessions → new folders:')
for (const p of plan) console.log(`   ${p.session.title}\n      ${p.session.source_folder === p.folder ? '= already' : `${p.session.source_folder}  →  ${p.folder}`}`)
console.log(`   ${sitewide ? `exists: ${sitewide.title}` : `NEW: ${SITEWIDE.title}  →  ${ROOT}/${SITEWIDE.folder}`}`)

if (WRITE) {
  for (const p of plan) if (p.session.source_folder !== p.folder) await sb.from('prelim_session').update({ source_folder: p.folder, notes: `Re-pointed 2026-09-07 to Vossie's SWP006 tender handover folder (was ${p.session.source_folder}).` }).eq('id', p.session.id)
  if (!sitewide) {
    const { data, error } = await sb.from('prelim_session').insert({ title: SITEWIDE.title, area: SITEWIDE.area, source_site_url: SOURCE_SITE, source_library: SOURCE_LIB, source_folder: `${ROOT}/${SITEWIDE.folder}`, notes: 'Site-wide standards & specs for the SWP006 tender pack (Vossie, 7 Sep 2026).', created_by_email: BY, created_by_name: 'Morné Cronjé' }).select('id, title, area, source_folder, status').single()
    if (error) throw error; sitewide = data; console.log(`   opened ${sitewide.id}`)
  }
}
if (sitewide) plan.push({ session: sitewide, folder: `${ROOT}/${SITEWIDE.folder}`, top: SITEWIDE.folder })

// ── 3. re-point already-pulled drawings to their moved file ─────────────────────────
const { data: docs } = await sb.from('prelim_document').select('id, session_id, source_file_name, source_file_url, document_number, quality_checked_at, created_at, working_file_name, markup_committed_at, markup_layer, routing').in('session_id', plan.map(p => p.session.id))
const byName = new Map(); for (const f of files) { const k = f.name.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(f) }
const inNewTree = new Set(files.map(f => f.webUrl))
let repointed = 0, waiting = 0, ambiguous = 0
console.log('\nalready-pulled drawings:')
for (const d of docs ?? []) {
  if (inNewTree.has(d.source_file_url)) continue
  const hits = byName.get(d.source_file_name.toLowerCase()) ?? []
  const p = plan.find(x => x.session.id === d.session_id)
  const inMySub = hits.filter(h => h.top === p?.top)
  const pick = inMySub.length === 1 ? inMySub[0] : hits.length === 1 ? hits[0] : null
  if (pick) {
    repointed++
    console.log(`   → ${d.document_number ?? d.source_file_name}  now at ${pick.path}${pick.top !== p?.top ? '  (different substation folder!)' : ''}`)
    if (WRITE) await sb.from('prelim_document').update({ source_file_url: pick.webUrl }).eq('id', d.id)
  } else if (hits.length > 1) { ambiguous++; console.log(`   ? ${d.source_file_name} appears ${hits.length}× in the new tree — left as is`) }
  else waiting++
}
console.log(`   re-pointed ${repointed} · not moved yet ${waiting} · ambiguous ${ambiguous}`)

// ── 3b. a file the engineer re-saved AFTER we pulled it: refresh the working copy, but only
//        while nobody has drawn on it or made a call (a marked-up copy is the room's record)
const dcSite = await siteId(DC_SITE), irDrive = await driveId(dcSite, IR_LIB)
const sessionFolder = (title, id) => `${PRELIM_FOLDER}/${title.replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)} ${id.slice(0, 8)}`
const byUrl = new Map(files.map(f => [f.webUrl, f]))
let refreshed = 0, stale = 0
for (const d of docs ?? []) {
  const f = byUrl.get(d.source_file_url) ?? (byName.get(d.source_file_name.toLowerCase()) ?? [])[0]
  if (!f || new Date(f.modified) <= new Date(d.created_at)) continue
  // A MOVE bumps lastModified without changing a byte. Compare content hashes with the
  // working copy before treating it as a re-save — a needless refresh throws away the
  // quality check the helper is working from.
  const srcHash = f.hash
  const wcHash = await (async () => { try { const sid = 'u!' + Buffer.from(d.working_file_url, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return (await gget(`/shares/${sid}/driveItem?$select=file`)).file?.hashes?.quickXorHash ?? null } catch { return null } })()
  if (srcHash && wcHash && srcHash === wcHash) continue
  const touched = d.markup_committed_at || d.routing || (d.markup_layer && Object.keys(d.markup_layer).length)
  if (touched) { stale++; console.log(`   ⚠ ${d.document_number ?? d.source_file_name}: source re-saved ${f.modified.slice(0, 16)} after the room worked on it — NOT refreshed`); continue }
  refreshed++
  console.log(`   ↻ ${d.document_number ?? d.source_file_name}: source re-saved ${f.modified.slice(0, 16)}, working copy refreshed`)
  if (WRITE) {
    const p = plan.find(x => x.session.id === d.session_id)
    const isPdf = /\.pdf$/i.test(f.name)
    const r = await retry(async () => { const r = await fetch(`${G}/drives/${srcDrive}/items/${f.id}/content${isPdf ? '' : '?format=pdf'}`, { headers: H }); if (!r.ok) throw new Error(`content ${r.status}`); return r })
    const bytes = await r.arrayBuffer()
    await retry(async () => { const r = await fetch(`${G}/sites/${dcSite}/drives/${irDrive}/root:/${enc(`${sessionFolder(p.session.title, p.session.id)}/${d.working_file_name}`)}:/content`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/pdf' }, body: bytes }); if (!r.ok) throw new Error(`upload ${r.status}`); return r.json() })
    await sb.from('prelim_document').update({ quality_checked_at: null, quality_open: null, quality_latest: null }).eq('id', d.id)
  }
}
console.log(`   working copies refreshed ${refreshed} · re-saved after review, left alone ${stale}`)

// ── 4. pull what is new ─────────────────────────────────────────────────────────────
const known = new Set((docs ?? []).map(d => d.source_file_url)); for (const d of docs ?? []) { const hits = byName.get(d.source_file_name.toLowerCase()) ?? []; for (const h of hits) known.add(h.webUrl) }
const fresh = files.filter(f => !known.has(f.webUrl))
console.log(`\nnew files to pull: ${fresh.length}`)
for (const [k, v] of tally(fresh, f => f.top)) console.log(`   ${v.toString().padStart(3)}  ${k}`)
if (!WRITE) { console.log('\n(dry run — pass --write)'); process.exit(0) }

const NUM = /6105A[A-Z0-9]{2,5}-[A-Z0-9]{4}-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}/i
let pulled = 0, failed = 0
for (const f of fresh) {
  const p = plan.find(x => x.top === f.top); if (!p) { console.log(`   ✗ ${f.path}: no session for folder "${f.top}"`); failed++; continue }
  try {
    const isPdf = /\.pdf$/i.test(f.name)
    const r = await retry(async () => { const r = await fetch(`${G}/drives/${srcDrive}/items/${f.id}/content${isPdf ? '' : '?format=pdf'}`, { headers: H }); if (!r.ok) throw new Error(`content ${r.status}`); return r })
    const bytes = await r.arrayBuffer()
    const workingName = isPdf ? f.name : f.name.replace(/\.[^.]+$/, '') + '.pdf'
    const up = await retry(async () => { const r = await fetch(`${G}/sites/${dcSite}/drives/${irDrive}/root:/${enc(`${sessionFolder(p.session.title, p.session.id)}/${workingName}`)}:/content`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/pdf' }, body: bytes }); if (!r.ok) throw new Error(`upload ${r.status}`); return r.json() })
    const no = (f.name.match(NUM) ?? [null])[0]?.toUpperCase() ?? null
    const { data: cddl } = no ? await sb.from('cddl_doc').select('id, docno, title, discipline, doc_type, revision').ilike('docno', no).limit(1).maybeSingle() : { data: null }
    const revMatch = f.name.match(/_([A-Z0-9]{1,4})\.[a-z]+$/i)
    const { error } = await sb.from('prelim_document').insert({
      session_id: p.session.id, cddl_doc_id: cddl?.id ?? null, document_number: cddl?.docno ?? no,
      revision: revMatch?.[1] ?? cddl?.revision ?? null, title: cddl?.title ?? f.name.replace(/\.[^.]+$/, ''),
      discipline: cddl?.discipline ?? f.path.split('/')[2]?.replace(/^\d+\.\s*/, '') ?? null, document_type: cddl?.doc_type ?? null,
      source_file_name: f.name, source_file_url: f.webUrl, working_file_name: workingName, working_file_url: up.webUrl, pulled_by_email: BY,
    })
    if (error) throw error
    pulled++; console.log(`   + ${f.path}`)
  } catch (e) { failed++; console.log(`   ✗ ${f.path}: ${e.message}`) }
}
console.log(`\npulled ${pulled} · failed ${failed}`)
