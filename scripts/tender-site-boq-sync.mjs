// Keep folder 03 of the tender pack (Bills of Quantities + Cable Schedules) in step with the
// engineers' live workbooks. Ruled by Morné, 10 Sep: the SOURCE for the BoQs and cable schedules
// is COLAB / PLANT WIDE SUBSTATIONS (PPE Working Folder) / Document Register / <substation> /
// BOQ & Cable Schedule - <substation>/ — NOT the LIVE DOCUMENTS snapshot the populate used, and
// not the SWP006 handover tree (which holds no spreadsheets). The engineers keep working on them,
// so this is re-run periodically: a pack copy is replaced only when the SOURCE bytes changed
// since the last sync (SharePoint re-saves an Office file on upload, so the pack copy's own hash
// never equals the source's — the source hash we last copied is kept in boq-sync-state.json),
// and takes the source's current file name. A file locked in Excel (423) is retried, then reported. Anything overwritten is first
// saved to %TEMP%/claude/k480/boq-backup/<timestamp>/ so a hand edit made in the pack is never lost.
//   node scripts/tender-site-boq-sync.mjs            dry run
//   node scripts/tender-site-boq-sync.mjs --write
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const SRC_ROOT = 'PLANT WIDE SUBSTATIONS (PPE Working Folder)/Document Register'
const ROOT = 'K480 SWP-006 Power and Balance of Plant', F03 = `${ROOT}/03 Section 2 - Schedule A2 - Unit Prices and BoQ`
const DEST = { GBOM: `${F03}/Bills of Quantities`, ESCH: `${F03}/Cable Schedules and MTO` }
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? '').toUpperCase()

const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async (u) => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} GET ${u.slice(0, 120)}`); return r.json() }
const enc = (p) => p.split('/').map(encodeURIComponent).join('/')
const SEL = '$select=id,name,folder,size,file,lastModifiedDateTime,lastModifiedBy'
async function walk(d, p, out = []) { let u = `/drives/${d}/root:/${enc(p)}:/children?${SEL}&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(d, `${p}/${k.name}`, out); else out.push({ id: k.id, name: k.name, path: `${p}/${k.name}`, size: k.size, hash: k.file?.hashes?.quickXorHash ?? null, mod: k.lastModifiedDateTime, by: k.lastModifiedBy?.user?.displayName ?? '' }) } u = j['@odata.nextLink'] } return out }
const k138 = await g('/sites/ppetechcoza.sharepoint.com:/sites/K138-BalanceofPlant'); const colab = (await g(`/sites/${k138.id}/drives?$select=id,name`)).value.find(x => x.name === 'COLAB').id
const packSite = await g('/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const pd = (await g(`/sites/${packSite.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents').id

// the source: one GBOM and one ESCH workbook per substation, xlsx/xlsm only
const src = (await walk(colab, SRC_ROOT)).filter(f => /BOQ & Cable Schedule/i.test(f.path) && /\.(xlsx|xlsm)$/i.test(f.name) && /-(GBOM|ESCH)-\d{4}/i.test(f.name))
const pack = (await walk(pd, F03)).filter(f => /\.(xlsx|xlsm)$/i.test(f.name))
const byStem = new Map(); for (const f of pack) { const s = stemOf(f.name); if (s) { if (!byStem.has(s)) byStem.set(s, []); byStem.get(s).push(f) } }
const STATE = 'C:/Users/mornec/AppData/Local/Temp/claude/k480/boq-sync-state.json'
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {}
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-'), BK = `C:/Users/mornec/AppData/Local/Temp/claude/k480/boq-backup/${stamp}/`
let replaced = 0, added = 0, same = 0, locked = 0
for (const f of src.sort((a, b) => a.name.localeCompare(b.name))) {
  const s = stemOf(f.name), type = /GBOM/i.test(s) ? 'GBOM' : 'ESCH', dest = DEST[type]
  const existing = byStem.get(s) ?? []
  const cur = existing[0]
  const line = `${s.padEnd(26)} source ${f.mod.slice(0, 16)} ${f.by.padEnd(17)} ${String(f.size).padStart(8)} b`
  const st = state[s]
  if (cur && st && st.sourceHash === f.hash && existing.some(e => e.name === st.packName)) { same++; console.log(`  =   ${line}  · unchanged since last sync ${st.syncedAt.slice(0, 16)}`); continue }
  if (!cur) { added++; console.log(`  +   ${line}  · not in pack → ${f.name}`) }
  else { replaced++; console.log(`  ↻   ${line}  · pack copy ${cur.mod.slice(0, 16)} ${cur.by} ${cur.size} b (${cur.name}) → replaced by ${f.name}`) }
  if (!WRITE) continue
  const bytes = Buffer.from(await (await fetch(`${G}/drives/${colab}/items/${f.id}/content`, { headers: H })).arrayBuffer())
  for (const old of existing) {
    fs.mkdirSync(BK, { recursive: true })
    fs.writeFileSync(BK + old.name, Buffer.from(await (await fetch(`${G}/drives/${pd}/items/${old.id}/content`, { headers: H })).arrayBuffer()))
    if (old.name !== f.name) { const d = await fetch(`${G}/drives/${pd}/items/${old.id}`, { method: 'DELETE', headers: H }); console.log(`        removed old pack copy ${old.name} (${d.status}), backed up to ${BK}`) }
    else console.log(`        backed up ${old.name} to ${BK}`)
  }
  let status = 0
  for (let attempt = 1; attempt <= 4 && !(status >= 200 && status < 300); attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, 4000 * attempt))
    const s2 = await fetch(`${G}/drives/${pd}/root:/${enc(`${dest}/${f.name}`)}:/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) })
    if (!s2.ok) { status = s2.status; continue }
    const { uploadUrl } = await s2.json()
    const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(bytes.length), 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes })
    status = r.status
  }
  if (status >= 200 && status < 300) {
    state[s] = { sourceHash: f.hash, sourceName: f.name, sourceModified: f.mod, packName: f.name, syncedAt: new Date().toISOString() }
    fs.writeFileSync(STATE, JSON.stringify(state, null, 1))
    console.log(`        written (${status})  ${dest.slice(F03.length + 1)}/${f.name}`)
  } else { locked++; if (cur) replaced--; else added--; console.log(`        ⚠ NOT written (${status}${status === 423 ? ' — locked, someone has it open in Excel' : ''})  ${f.name}; pack still holds ${cur ? cur.name : 'nothing'}`) }
}
// pack workbooks with no source any more (engineers renamed/renumbered) — reported, never deleted
const srcStems = new Set(src.map(f => stemOf(f.name)))
for (const f of pack.filter(f => stemOf(f.name) && !srcStems.has(stemOf(f.name)))) console.log(`  ?   ${f.name}  — in the pack, no matching workbook in the Working Folder`)
console.log(`\n${WRITE ? 'done' : 'dry run'}: ${replaced} replaced · ${added} added · ${same} unchanged (source ${src.length} workbooks)${WRITE ? '' : '   — add --write'}`)
