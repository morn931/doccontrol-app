// Probe: find Vossie's new "SWP006 Tender Handover Documents" folder(s) in COLAB and list
// what is in them right now (subfolders per discipline, files), plus where the four open
// prelim sessions currently point. Read-only.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const retry = async (fn, n = 5) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))) } } }
const tok = (await retry(async () => (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json())).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const gget = async (u) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 80)}`); return r.json() })
const siteId = async (url) => { const u = new URL(url); return (await gget(`/sites/${u.hostname}:${u.pathname}`)).id }
const driveId = async (sid, name) => { const ds = (await gget(`/sites/${sid}/drives?$select=id,name`)).value ?? []; const d = ds.find(x => x.name === name); if (!d) throw new Error(`library "${name}" not found`); return d.id }
const SITE = process.env.PRELIM_SOURCE_SITE_URL || 'https://ppetechcoza.sharepoint.com/sites/K138-BalanceofPlant'
const sid = await siteId(SITE), did = await driveId(sid, process.env.PRELIM_SOURCE_LIBRARY || 'COLAB')

const children = async (path) => { const enc = path ? `root:/${path.split('/').map(encodeURIComponent).join('/')}:/children` : 'root/children'; let out = [], u = `/drives/${did}/${enc}?$select=id,name,folder,file,size,lastModifiedDateTime,webUrl&$top=999`; while (u) { const j = await gget(u); out.push(...(j.value ?? [])); u = j['@odata.nextLink'] } return out }
// find every folder whose name mentions "tender handover", anywhere up to 4 levels deep
const found = []
async function walk(path, depth) {
  const kids = await children(path)
  for (const k of kids) {
    if (!k.folder) continue
    const p = path ? `${path}/${k.name}` : k.name
    if (/tender\s*hand\s*over/i.test(k.name)) found.push({ path: p, modified: k.lastModifiedDateTime })
    else if (depth < 4) await walk(p, depth + 1)
  }
}
await walk('', 0)
console.log(`folders matching "tender handover": ${found.length}`)
for (const f of found) {
  console.log(`\n== ${f.path}  (modified ${f.modified})`)
  const kids = await children(f.path)
  for (const k of kids.filter(x => x.folder)) {
    const sub = await children(`${f.path}/${k.name}`)
    const files = sub.filter(x => x.file), dirs = sub.filter(x => x.folder)
    console.log(`  [${k.name}]  ${files.length} files${dirs.length ? `, ${dirs.length} subfolders (${dirs.map(d => d.name).join(', ')})` : ''}`)
    for (const x of files.slice(0, 60)) console.log(`      ${x.name}  ${(x.size / 1024).toFixed(0)} KB  ${x.lastModifiedDateTime.slice(0, 16)}`)
  }
  const loose = kids.filter(x => x.file)
  if (loose.length) { console.log(`  (loose files: ${loose.length})`); for (const x of loose.slice(0, 40)) console.log(`      ${x.name}`) }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: sessions } = await sb.from('prelim_session').select('id, title, status, source_folder, prelim_document(id, outcome, routing, returned_at, markup_committed_at, markup_comments, quality_checked_at)').order('created_at')
console.log('\nsessions:')
for (const s of sessions ?? []) {
  const d = s.prelim_document ?? []
  console.log(`  ${s.status.padEnd(6)} ${s.title}\n         folder: ${s.source_folder}\n         docs ${d.length} · outcome≠pending ${d.filter(x => x.outcome !== 'pending').length} · routed ${d.filter(x => x.routing).length} · marks saved ${d.filter(x => x.markup_committed_at).length} · comments ${d.filter(x => Array.isArray(x.markup_comments) && x.markup_comments.length).length} · quality checked ${d.filter(x => x.quality_checked_at).length}`)
}
