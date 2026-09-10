// Put the CURRENT EDL into the tender pack site — PPE's own Engineering Register layout (10 Sep);
// Fluor's Exhibit Four is one workbook for both. The EDL comes from CoreReports' live export
// (/api/export-swp006-edl: Fluor's layout, PPE + vendor rows, PLH for anything not issued or
// not received, and the "Location in tender pack" column read off this very site), so it is
// never typed and never stale. Any older EDL in those two folders (the 2-Sep DRAFT) is removed.
//   node scripts/tender-site-edl.mjs            dry run
//   node scripts/tender-site-edl.mjs --write
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
// format=ppe since 10 Sep (Morné: our own Engineering Register layout with a document-type legend, not Fluor's)
const EXPORT = process.env.SWP006_EDL_EXPORT_URL || 'https://reports.coreflow.build/api/export-swp006-edl?token=f6c68725d7673c6a090acc40442ff6d2b33b032f&format=ppe'
// 10 Sep (Morné): the register carries its own number, from the Scope of Works Appendix M
const NAME = '6105AK124-6200-GLST-0001_A - K480 SWP006 Construction Tender Document Register.xlsx'
const ROOT = 'K480 SWP-006 Power and Balance of Plant'
// One folder for both sections since 9 Sep (Marnus + Morné); Fluor's Exhibit Four is one workbook.
const FOLDERS = ['05 PART 3 - Sections 4 & 5 - Specifications, Plans & Drawings (EDL)']

const res = await fetch(EXPORT)
if (!res.ok) { console.error(`export failed: ${res.status} ${(await res.text()).slice(0, 200)}`); process.exit(1) }
const bytes = Buffer.from(await res.arrayBuffer())
console.log(`fetched EDL export: ${(bytes.length / 1024).toFixed(0)} KB`)

const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async u => { const r = await fetch(G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 100)}`); return r.json() }
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const site = await g('/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const d = (await g(`/sites/${site.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents')
for (const f of FOLDERS) {
  const kids = (await g(`/drives/${d.id}/root:/${enc(`${ROOT}/${f}`)}:/children?$select=id,name,file`)).value.filter(k => k.file && /EDL_SWP006|GLST-0001/i.test(k.name) && k.name !== NAME)
  for (const k of kids) { if (WRITE) { const r = await fetch(`${G}/drives/${d.id}/items/${k.id}`, { method: 'DELETE', headers: H }); console.log(`  removed old EDL (${r.status})  ${f}/${k.name}`) } else console.log(`  would remove  ${f}/${k.name}`) }
  if (!WRITE) { console.log(`  would write   ${f}/${NAME}`); continue }
  const s = await fetch(`${G}/drives/${d.id}/root:/${enc(`${ROOT}/${f}/${NAME}`)}:/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) })
  if (!s.ok) throw new Error(`upload session ${s.status}`)
  const { uploadUrl } = await s.json()
  const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(bytes.length), 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes })
  console.log(`  written (${r.status})  ${f}/${NAME}`)
}
console.log(WRITE ? 'done' : 'dry run — add --write')
