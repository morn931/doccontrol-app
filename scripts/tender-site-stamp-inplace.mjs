// Stamp the UNSTAMPED PDFs sitting in the tender pack's folder 06 (Marnus dropped 31 general
// standards straight into the pack on 10 Sep, bypassing the review tool). These are already
// COPIES — the sources live elsewhere — so the stamp goes on the pack file itself: download,
// stamp every page ISSUED FOR TENDER ONLY + today's date, upload under the " - ISSUED FOR
// TENDER.pdf" name every other file in 06 carries, delete the unstamped original. The
// unstamped bytes are kept in %TEMP%/claude/k480/stamp-inplace-backup/<timestamp>/.
//   node scripts/tender-site-stamp-inplace.mjs            dry run (lists what it would stamp)
//   node scripts/tender-site-stamp-inplace.mjs --write
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const { stampIssuedForTender, tenderStampDate, tenderCopyName } = await import('../lib/prelim/tender-stamp.ts')
const WRITE = process.argv.includes('--write')
const ROOT = 'K480 SWP-006 Power and Balance of Plant', SEC = '05 PART 3 - Sections 4 & 5 - Specifications, Plans & Drawings (EDL)'
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async u => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 100)}`); return r.json() }
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const site = await g('/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const pd = (await g(`/sites/${site.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents').id
const files = []
async function walk(p) { let u = `/drives/${pd}/root:/${enc(p)}:/children?$select=id,name,folder,size,parentReference&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(`${p}/${k.name}`); else files.push({ id: k.id, name: k.name, size: k.size, parentId: k.parentReference?.id, path: `${p}/${k.name}` }) } u = j['@odata.nextLink'] } }
await walk(`${ROOT}/${SEC}`)
const targets = files.filter(f => /\.pdf$/i.test(f.name) && !/ISSUED FOR TENDER/i.test(f.name))
console.log(`PDFs in 06: ${files.filter(f => /\.pdf$/i.test(f.name)).length} · unstamped: ${targets.length}`)
for (const t of targets) console.log(`   ${t.path.slice(ROOT.length + SEC.length + 2)}  (${(t.size / 1024).toFixed(0)} KB)`)
if (!WRITE) { console.log('\ndry run — add --write'); process.exit(0) }
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-'), BK = `C:/Users/mornec/AppData/Local/Temp/claude/k480/stamp-inplace-backup/${stamp}/`; fs.mkdirSync(BK, { recursive: true })
const date = tenderStampDate()
let ok = 0, failed = 0
for (const t of targets) {
  try {
    const bytes = new Uint8Array(await (await fetch(`${G}/drives/${pd}/items/${t.id}/content`, { headers: H })).arrayBuffer())
    fs.writeFileSync(BK + t.name, bytes)
    const { bytes: stamped, pages } = await stampIssuedForTender(bytes, date)
    const outName = tenderCopyName(t.name.replace(/\.PDF$/, '.pdf'))
    const s = await fetch(`${G}/drives/${pd}/items/${t.parentId}:/${encodeURIComponent(outName)}:/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name: outName } }) })
    if (!s.ok) throw new Error(`upload session ${s.status}`)
    const { uploadUrl } = await s.json(); const CH = 10 * 320 * 1024
    for (let off = 0; off < stamped.length; off += CH) { const end = Math.min(off + CH, stamped.length); const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(end - off), 'Content-Range': `bytes ${off}-${end - 1}/${stamped.length}` }, body: stamped.slice(off, end) }); if (!r.ok) throw new Error(`upload chunk ${r.status}`) }
    const d = await fetch(`${G}/drives/${pd}/items/${t.id}`, { method: 'DELETE', headers: H })
    ok++; console.log(`   ok  ${pages}p  ${t.name}  →  ${outName}  (original removed ${d.status})`)
  } catch (e) { failed++; console.log(`   FAILED ${t.name}: ${String(e.message ?? e).slice(0, 160)}`) }
}
console.log(`\nstamped in place: ${ok} · failed: ${failed} · unstamped originals kept in ${BK}`)
