// ONE folder for Sections 4 and 5, mirroring the COLAB handover tree exactly.
//
//   node scripts/tender-site-restructure.mjs            dry run
//   node scripts/tender-site-restructure.mjs --write
//
// Marnus + Morné, 9 Sep 2026: "Section 4 and section 5 should just be one folder; inside it the
// folder structure should follow exactly our SWP006 Tender Handover Documents folder structure."
// Fluor's own Exhibit Four is one EDL workbook for both sections, so one folder is consistent
// with what they issued. The area and discipline folder names are read LIVE from COLAB, never
// typed here, so the pack cannot drift from the tree the team works in.
//
// Every file under the old "06 Section 4 …" and "07 Section 5 …" is MOVED (server-side, same
// name) into <NEW>/<area>/<discipline>: a stamped copy goes where its COLAB source sits; a
// document with no COLAB counterpart (the issued copies taken from CoreDocs / ENG2) goes by
// area code and discipline letter onto COLAB's folder names. The EDL workbook goes to the top
// of the new folder. The old 06 and 07 are deleted once empty. Nothing in COLAB is touched.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const ROOT = 'K480 SWP-006 Power and Balance of Plant'
export const NEW = '05 PART 3 - Sections 4 & 5 - Specifications, Plans & Drawings (EDL)'
const OLD = ['06 Section 4 - Specifications and Plans (EDL)', '07 Section 5 - Drawings (EDL)']
const COLAB_ROOT = 'SWP006 TENDER HANDOVER DOCUMENTS'

const retry = async (fn, n = 5) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n || /^4(0[0-9]|1[0-9])\b/.test(String(e.message))) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))) } } }
const tok = (await retry(async () => (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json())).access_token
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, G = 'https://graph.microsoft.com/v1.0'
const call = (method, u, body) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${r.status} ${method} ${u.slice(0, 110)} ${(await r.text()).slice(0, 160)}`); return r.status === 204 ? null : r.json() })
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? '').toUpperCase()

// ── COLAB: the tree to mirror, and where each document sits in it ────────────────────────
const k138 = await call('GET', '/sites/ppetechcoza.sharepoint.com:/sites/K138-BalanceofPlant'); const colab = (await call('GET', `/sites/${k138.id}/drives?$select=id,name`)).value.find(d => d.name === 'COLAB').id
const kids = async (drv, p) => { let out = [], u = `/drives/${drv}/root:/${enc(p)}:/children?$select=id,name,folder,file&$top=999`; while (u) { const j = await call('GET', u); out.push(...(j.value ?? [])); u = j['@odata.nextLink'] } return out }
const tree = [] // ['<area>/<discipline>', ...]
const colabHome = new Map() // stem -> '<area>/<discipline>'
for (const a of (await kids(colab, COLAB_ROOT)).filter(k => k.folder)) {
  for (const d of (await kids(colab, `${COLAB_ROOT}/${a.name}`)).filter(k => k.folder && k.name !== 'Issued for Tender')) {
    tree.push(`${a.name}/${d.name}`)
    for (const f of await kids(colab, `${COLAB_ROOT}/${a.name}/${d.name}`)) { if (f.folder && f.name === 'Issued for Tender') { for (const s of await kids(colab, `${COLAB_ROOT}/${a.name}/${d.name}/Issued for Tender`)) { const st = stemOf(s.name); if (st && !colabHome.has(st)) colabHome.set(st, `${a.name}/${d.name}`) } } else if (!f.folder) { const st = stemOf(f.name); if (st && !colabHome.has(st)) colabHome.set(st, `${a.name}/${d.name}`) } }
  }
}
const areas = [...new Set(tree.map(t => t.split('/')[0]))]
console.log(`COLAB tree: ${areas.length} areas, ${tree.length} discipline folders; ${colabHome.size} documents placed there`)

// ── the rule for a document with no COLAB counterpart ────────────────────────────────────
const AREA_BY_CODE = { '0000': 1, '9134': 1, '0100': 1, '6200': 2, '6212': 2, '6260': 2, '6243': 2, '6253': 2, '6254': 2, '6256': 2, '6262': 2, '6263': 2, '6264': 2, '6286': 3, '6242': 4, '6251': 4, '6241': 5, '6290': 5, '6292': 5 }
const areaName = n => areas.find(a => a.startsWith(`${n}.`))
const pick = (areaIdx, wants) => { const a = areaName(areaIdx); const opts = tree.filter(t => t.startsWith(a + '/')).map(t => t.split('/')[1]); for (const w of wants) { const hit = opts.find(o => o.toLowerCase().includes(w)); if (hit) return `${a}/${hit}` } return `${a}/${opts[0]}` }
const flagged = []
function ruleHome(name) {
  const m = name.match(/6105A[A-Z0-9]+-(\d{4})-([A-Z])-?[A-Z0-9]{3}-\d{4}/i)
  const code = m?.[1] ?? '0000', letter = (m?.[2] ?? 'E').toUpperCase()
  const areaIdx = AREA_BY_CODE[code] ?? 1
  const wants = letter === 'E' ? ['electrical'] : /[CSW]/.test(letter) ? ['civil'] : letter === 'I' ? ['instrument'] : /[AF]/.test(letter) ? ['automation'] : /[MP]/.test(letter) ? ['mechanical', 'underground'] : ['electrical']
  const home = pick(areaIdx, wants)
  if (/[MP]/.test(letter) && areaIdx === 1) flagged.push(`${name} → ${home} (no mechanical folder in Site Wide)`)
  return home
}

// ── the pack: create the new tree, move everything ───────────────────────────────────────
const pack = await call('GET', '/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const drv = (await call('GET', `/sites/${pack.id}/drives?$select=id,name`)).value.find(d => d.name === 'Documents').id
const folderIds = new Map()
async function folderId(path) {
  if (folderIds.has(path)) return folderIds.get(path)
  try { const j = await call('GET', `/drives/${drv}/root:/${enc(path)}?$select=id,folder`); folderIds.set(path, j.id); return j.id } catch (e) { if (!String(e.message).startsWith('404')) throw e }
  if (!WRITE) { folderIds.set(path, `(new) ${path}`); return folderIds.get(path) }
  const parent = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1)
  const pid = await folderId(parent)
  const j = await call('POST', `/drives/${drv}/items/${pid}/children`, { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }); folderIds.set(path, j.id); return j.id
}
console.log(`\nnew folder: ${NEW}`)
await folderId(`${ROOT}/${NEW}`)
for (const t of tree) await folderId(`${ROOT}/${NEW}/${t}`)
console.log(`  ${tree.length} area/discipline folders ${WRITE ? 'ensured' : 'would be created'}`)

const files = []
async function walk(p) { for (const k of await kids(drv, p)) { if (k.folder) await walk(`${p}/${k.name}`); else files.push({ id: k.id, name: k.name, path: `${p}/${k.name}` }) } }
for (const o of OLD) { try { await walk(`${ROOT}/${o}`) } catch (e) { console.log(`  ${o}: ${String(e.message).slice(0, 60)}`) } }
console.log(`\nfiles under the old 06/07: ${files.length}`)
const plan = []
let edlSeen = false
for (const f of files) {
  if (/EDL_SWP006/i.test(f.name)) { if (edlSeen) { plan.push({ f, target: null, why: 'duplicate EDL — delete' }); continue } edlSeen = true; plan.push({ f, target: `${ROOT}/${NEW}`, why: 'EDL workbook' }); continue }
  const st = stemOf(f.name)
  const home = (st && colabHome.get(st)) || ruleHome(f.name)
  plan.push({ f, target: `${ROOT}/${NEW}/${home}`, why: st && colabHome.has(st) ? 'as in COLAB' : 'by rule' })
}
const byTarget = {}; for (const p of plan) byTarget[p.target ? p.target.slice(ROOT.length + NEW.length + 2) || '(top)' : '(delete)'] = (byTarget[p.target ? p.target.slice(ROOT.length + NEW.length + 2) || '(top)' : '(delete)'] ?? 0) + 1
for (const [k, v] of Object.entries(byTarget).sort()) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log(`  placed as in COLAB: ${plan.filter(p => p.why === 'as in COLAB').length} · by rule: ${plan.filter(p => p.why === 'by rule').length}`)
if (flagged.length) { console.log('\n⚠ site-wide mechanical/piping documents — no such folder in COLAB, filed as shown:'); for (const x of flagged) console.log('   ', x) }

if (WRITE) {
  let moved = 0, deleted = 0, failed = 0
  const q = plan.slice()
  await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) { const p = q.shift(); try { if (!p.target) { await call('DELETE', `/drives/${drv}/items/${p.f.id}`); deleted++; continue } const pid = await folderId(p.target); await call('PATCH', `/drives/${drv}/items/${p.f.id}`, { parentReference: { id: pid }, name: p.f.name, '@microsoft.graph.conflictBehavior': 'replace' }); moved++ } catch (e) { failed++; console.log(`  FAILED ${p.f.name}: ${String(e.message).slice(0, 140)}`) } } }))
  console.log(`\nmoved ${moved} · deleted ${deleted} · failed ${failed}`)
  // remove the old folders once empty
  for (const o of OLD) { const left = []; try { await (async function w(p) { for (const k of await kids(drv, p)) { if (k.folder) await w(`${p}/${k.name}`); else left.push(k.name) } })(`${ROOT}/${o}`) } catch { continue } if (left.length) { console.log(`  ${o}: ${left.length} file(s) still inside — NOT deleted: ${left.slice(0, 5).join(', ')}`); continue } const it = await call('GET', `/drives/${drv}/root:/${enc(`${ROOT}/${o}`)}?$select=id`); await call('DELETE', `/drives/${drv}/items/${it.id}`); console.log(`  removed empty ${o}`) }
} else console.log('\ndry run — add --write')
