// Walk the K480 SWP-006 tender pack site → %TEMP%/claude/k480/site-walk.json, then build the
// hand-over manifest workbook (build-manifest.py) with the EDL cross-check against the
// CURRENT live EDL export. Run last thing before hand-over, after the copy scripts.
//   node scripts/tender-site-manifest.mjs
import fs from 'node:fs'
import { execSync } from 'node:child_process'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const T = 'C:/Users/mornec/AppData/Local/Temp/claude/k480/'
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async u => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 100)}`); return r.json() }
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const site = await g('/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const d = (await g(`/sites/${site.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents')
const ROOT = 'K480 SWP-006 Power and Balance of Plant'; const files = []
async function walk(p) { let u = `/drives/${d.id}/root:/${enc(p)}:/children?$select=id,name,folder,size,lastModifiedDateTime,webUrl&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(`${p}/${k.name}`); else files.push({ id: k.id, name: k.name, path: `${p}/${k.name}`.slice(ROOT.length + 1), size: k.size, mod: k.lastModifiedDateTime, url: k.webUrl }) } u = j['@odata.nextLink'] } }
await walk(ROOT)
fs.writeFileSync(T + 'site-walk.json', JSON.stringify(files, null, 1)); console.log('site files:', files.length)
// the live EDL, for the cross-check
const edl = await fetch(process.env.SWP006_EDL_EXPORT_URL || 'https://reports.coreflow.build/api/export-swp006-edl?token=f6c68725d7673c6a090acc40442ff6d2b33b032f')
fs.writeFileSync(T + 'edl-final.xlsx', Buffer.from(await edl.arrayBuffer()))
execSync(`python "${T}xcheck.py" && python "${T}build-manifest.py"`, { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
