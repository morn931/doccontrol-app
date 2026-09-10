// Put the REPAIRED Bills (boq-repair/repaired/) into the pack's Bills of Quantities folder,
// backing up whatever is there first. Used 10 Sep after the structural repair; re-used after
// each values merge. Never touches the Working Folder.
//   node scripts/tender-site-boq-place.mjs [--from=<folder>] [--write]
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const REP = process.argv.find(a => a.startsWith('--from='))?.slice(7) ?? 'C:/Users/mornec/AppData/Local/Temp/claude/k480/boq-repair/repaired/'
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async u => { const r = await fetch(G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 100)}`); return r.json() }
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1] ?? '').toUpperCase()
const site = await g('/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const pd = (await g(`/sites/${site.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents').id
const F = 'K480 SWP-006 Power and Balance of Plant/03 Section 2 - Schedule A2 - Unit Prices and BoQ/Bills of Quantities'
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-'), BK = `C:/Users/mornec/AppData/Local/Temp/claude/k480/boq-backup/${stamp}-pack-before-place/`
const pack = (await g(`/drives/${pd}/root:/${enc(F)}:/children?$select=id,name,size,lastModifiedDateTime,lastModifiedBy`)).value
for (const fn of fs.readdirSync(REP).filter(f => f.endsWith('.xlsx'))) {
  const s = stemOf(fn); const olds = pack.filter(p => stemOf(p.name) === s)
  const had = olds.map(o => `${o.name} ${o.lastModifiedDateTime.slice(0, 16)} ${o.lastModifiedBy?.user?.displayName ?? ''}`).join('; ') || 'nothing'
  if (!WRITE) { console.log(`  would place ${fn}  [pack has: ${had}]`); continue }
  fs.mkdirSync(BK, { recursive: true })
  for (const o of olds) {
    fs.writeFileSync(BK + o.name, Buffer.from(await (await fetch(`${G}/drives/${pd}/items/${o.id}/content`, { headers: H })).arrayBuffer()))
    if (o.name !== fn) { const d = await fetch(`${G}/drives/${pd}/items/${o.id}`, { method: 'DELETE', headers: H }); console.log(`  removed ${o.name} (${d.status})`) }
  }
  const bytes = fs.readFileSync(REP + fn)
  let status = 0, body = ''
  for (let attempt = 1; attempt <= 3 && !(status >= 200 && status < 300); attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, 5000))
    const s2 = await fetch(`${G}/drives/${pd}/root:/${enc(`${F}/${fn}`)}:/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) })
    if (!s2.ok) { status = s2.status; body = (await s2.text()).slice(0, 120); continue }
    const { uploadUrl } = await s2.json()
    const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(bytes.length), 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes }); status = r.status
  }
  console.log(`  ${status >= 200 && status < 300 ? 'written' : '⚠ NOT written'} (${status}) ${fn}${body ? ' ' + body : ''}  [pack had: ${had}]`)
}
if (WRITE) console.log('backups in', BK); else console.log('dry run — add --write')
