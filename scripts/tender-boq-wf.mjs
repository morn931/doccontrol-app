// Working Folder BoQs: fetch the four live Bills, or put a corrected copy back.
//   node scripts/tender-boq-wf.mjs fetch <dir>            download the four GBOM Bills into <dir> (+ _meta.json)
//   node scripts/tender-boq-wf.mjs put <file> [--write]   replace the Working Folder Bill that carries the same
//                                                         number with <file> (a content fix made on the engineers'
//                                                         behalf — Vossie's rows 78/79, 10 Sep); backs up the old bytes
import fs from 'node:fs'
import path from 'node:path'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const [mode, arg] = process.argv.slice(2); const WRITE = process.argv.includes('--write')
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async u => { const r = await fetch(G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 100)}`); return r.json() }
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1] ?? '').toUpperCase()
const k138 = await g('/sites/ppetechcoza.sharepoint.com:/sites/K138-BalanceofPlant'); const colab = (await g(`/sites/${k138.id}/drives?$select=id,name`)).value.find(x => x.name === 'COLAB').id
const bills = []
const subs = (await g(`/drives/${colab}/root:/${enc('PLANT WIDE SUBSTATIONS (PPE Working Folder)/Document Register')}:/children?$select=name,folder`)).value.filter(x => x.folder)
for (const s of subs) { let kids = []; try { kids = (await g(`/drives/${colab}/root:/${enc(`PLANT WIDE SUBSTATIONS (PPE Working Folder)/Document Register/${s.name}/BOQ & Cable Schedule - ${s.name}`)}:/children?$select=id,name,size,lastModifiedDateTime,lastModifiedBy,parentReference`)).value ?? [] } catch { continue }; for (const f of kids) if (/-GBOM-\d{4}.*\.xlsx$/i.test(f.name)) bills.push({ ...f, sub: s.name }) }
if (mode === 'fetch') {
  fs.mkdirSync(arg, { recursive: true }); const meta = []
  for (const f of bills) { fs.writeFileSync(path.join(arg, f.name), Buffer.from(await (await fetch(`${G}/drives/${colab}/items/${f.id}/content`, { headers: H })).arrayBuffer())); meta.push({ sub: f.sub, name: f.name, modified: f.lastModifiedDateTime, by: f.lastModifiedBy?.user?.displayName }); console.log(`${f.name.padEnd(60)} ${f.lastModifiedDateTime.slice(0, 16)} ${f.lastModifiedBy?.user?.displayName}`) }
  fs.writeFileSync(path.join(arg, '_meta.json'), JSON.stringify(meta, null, 1))
} else if (mode === 'put') {
  const name = path.basename(arg); const s = stemOf(name); const target = bills.find(b => stemOf(b.name) === s)
  if (!target) { console.log('no Working Folder Bill with number', s); process.exit(1) }
  console.log(`${WRITE ? 'replacing' : 'would replace'} ${target.name} (${target.lastModifiedDateTime.slice(0, 16)} ${target.lastModifiedBy?.user?.displayName}) with ${name}`)
  if (!WRITE) process.exit(0)
  const bk = `C:/Users/mornec/AppData/Local/Temp/claude/k480/boq-backup/${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}-working-folder/`; fs.mkdirSync(bk, { recursive: true })
  fs.writeFileSync(bk + target.name, Buffer.from(await (await fetch(`${G}/drives/${colab}/items/${target.id}/content`, { headers: H })).arrayBuffer()))
  const bytes = fs.readFileSync(arg)
  const sess = await fetch(`${G}/drives/${colab}/items/${target.id}/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) })
  if (!sess.ok) { console.log('upload session', sess.status, (await sess.text()).slice(0, 120)); process.exit(1) }
  const { uploadUrl } = await sess.json()
  const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(bytes.length), 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes })
  console.log(`written (${r.status}); old bytes in ${bk}`)
}
