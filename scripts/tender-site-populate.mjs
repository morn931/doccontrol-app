// Populate the K480 SWP-006 tender pack site from the two working sources.
//
//   node scripts/tender-site-populate.mjs            dry run — lists every copy it would make
//   node scripts/tender-site-populate.mjs --write    copy
//
// Source A — the stamped "ISSUED FOR TENDER" copies in COLAB (K138 site),
//   SWP006 TENDER HANDOVER DOCUMENTS/<area>/<discipline>/Issued for Tender/<doc> - ISSUED FOR TENDER.pdf
//   → 07 Section 5 - Drawings (EDL)/Supporting drawings/<area>/<discipline>/      for drawing types
//   → 06 Section 4 - Specifications and Plans (EDL)/Supporting documents/<area>/<discipline>/  for the rest
//   Drawing = the document-type code in the number is LAY GAD SEC DIA DTL PFD FND PLN SLD
//   (layouts, general arrangements, sections, diagrams, details, PFDs, foundations, plans,
//   single lines). Everything else — TMP, ITD, SCH, DST, DBD, SPC, CAL — is a specification,
//   schedule, datasheet or plan and belongs in Section 4.
//
// Source B — the seven deliverables in LIVE DOCUMENTS (K138 site),
//   K480 SWP-006 Power and Balance of Plant/01 PPE DELIVERABLES - the seven outstanding items/<n>/
//   Working documents go to 01–07; Fluor's TEMPLATE files and the K480 pack go to 90 Reference.
//   Where a numbered file exists beside its "XXXX" (un-numbered) draft, only the numbered one is
//   taken. The 31-Aug supporting snapshot under item 6 is NOT copied: the stamped copies are the
//   reviewed, current set. It is only compared, and the difference reported.
//
// Idempotent: a destination file that already exists with the same size is skipped.
// Copies are server-side (Graph copy), so nothing passes through this machine.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const DST_SITE = 'https://ppetechcoza.sharepoint.com/sites/K480SWP-006TenderPack'
const DST_LIB = process.env.TENDER_LIBRARY || 'Documents'
const SRC_SITE = 'https://ppetechcoza.sharepoint.com/sites/K138-BalanceofPlant'
const ROOT = 'K480 SWP-006 Power and Balance of Plant'
const COLAB_ROOT = 'SWP006 TENDER HANDOVER DOCUMENTS'
const LIVE_ROOT = 'K480 SWP-006 Power and Balance of Plant/01 PPE DELIVERABLES - the seven outstanding items'
const DRAWING = /^(LAY|GAD|SEC|DIA|DTL|PFD|FND|PLN|SLD)$/
const SECTION_4_5 = '05 PART 3 - Sections 4 & 5 - Specifications, Plans & Drawings (EDL)'

const retry = async (fn, n = 5) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n || /^4(0[0-9]|1[0-9]|2[0-8])\b/.test(String(e.message))) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))) } } }
const tok = (await retry(async () => (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json())).access_token
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, G = 'https://graph.microsoft.com/v1.0'
const call = (method, u, body) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${r.status} ${method} ${u.slice(0, 120)} ${(await r.text()).slice(0, 200)}`); if (r.status === 202) return { monitor: r.headers.get('location') }; return r.status === 204 ? null : r.json() })
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const siteId = async (url) => { const u = new URL(url); return (await call('GET', `/sites/${u.hostname}:${u.pathname}`)).id }
const drive = async (sid, name) => { const d = (await call('GET', `/sites/${sid}/drives?$select=id,name`)).value.find(x => x.name === name); if (!d) throw new Error(`library "${name}" not on ${sid}`); return d.id }
const children = async (did, path) => { let out = [], u = `/drives/${did}/root:/${enc(path)}:/children?$select=id,name,folder,file,size&$top=999`; while (u) { const j = await call('GET', u); out.push(...(j.value ?? [])); u = j['@odata.nextLink'] } return out }
async function walk(did, path, acc = []) { for (const k of await children(did, path)) { const p = `${path}/${k.name}`; if (k.folder) await walk(did, p, acc); else acc.push({ id: k.id, name: k.name, size: k.size ?? 0, path: p }) } return acc }

const src = await siteId(SRC_SITE), dst = await siteId(DST_SITE)
const colab = await drive(src, 'COLAB'), live = await drive(src, 'LIVE DOCUMENTS'), out = await drive(dst, DST_LIB)

// ---- destination folders: resolve by path, create when missing (cached) ----
const folderIds = new Map()
async function folderId(path) {
  if (folderIds.has(path)) return folderIds.get(path)
  try { const j = await call('GET', `/drives/${out}/root:/${enc(path)}?$select=id,folder`); if (!j.folder) throw new Error(`${path} is a file`); folderIds.set(path, j.id); return j.id }
  catch (e) { if (!String(e.message).startsWith('404')) throw e }
  if (!WRITE) { folderIds.set(path, null); console.log(`  would create folder  ${path}`); return null }
  const parent = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1)
  const pid = await folderId(parent)
  const j = await call('POST', `/drives/${out}/items/${pid}/children`, { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
  folderIds.set(path, j.id); console.log(`  created folder       ${path}`); return j.id
}
// Marnus re-files documents by hand (10 Sep: the site-wide tree renamed, vendor documents moved
// under Plant Main Substation). A file that exists ANYWHERE in the pack — by name or by document
// number — is never copied again, whatever folder the rule would have put it in.
const stemOf = s => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? '').toUpperCase()
const packAll = await walk(out, ROOT)
const packNames = new Set(packAll.map(f => f.name)), packStems = new Set(packAll.map(f => stemOf(f.name)).filter(Boolean))
const existing = new Map() // dest folder path -> Map(name -> size)
async function destListing(path) {
  if (existing.has(path)) return existing.get(path)
  let m = new Map()
  try { for (const k of await children(out, path)) if (!k.folder) m.set(k.name, k.size ?? 0) } catch (e) { if (!String(e.message).startsWith('404')) throw e }
  existing.set(path, m); return m
}

// ---- the copy queue ----
// Marnus renamed the site-wide tree in the pack on 10 Sep; COLAB still carries Vossie's names.
// The pack is what Fluor sees, so the pack's names win. Anything from COLAB's site-wide folders
// is re-addressed here before it is placed.
const SITEWIDE_MAP = {
  '1. Substations BOP Project Site Wide': '1. General Standards and Specifications',
  '1. Automation General Standards and Specs': '1. Control & Automation General Standards and Specs',
  '3. E-House General Standards and Specs': '5. Electrical General Standards and Specs',
  '4. EHS and Fire Protection General Standards': '7. HSE General Standards and Specs',
  '7. Site Conditions General Standards': '7. HSE General Standards and Specs',
  '8. Underground Services General Standards and Specs': '4. Mechanical General Standards and Specs',
  // 10 Sep 14:50 — Marnus renamed two substation folders in the pack
  '2. Plant Main Substation': '2. Main Consumer (Plant Main) Substation',
  '4. Power Station Substation': '4. Main Intake (Power Station) Substation',
}
const reAddress = (dest) => dest.split('/').map(seg => SITEWIDE_MAP[seg] ?? seg).join('/')
const queue = [] // { srcDrive, srcId, srcPath, destFolder, name, size }
const plan = (srcDrive, f, destFolder, name = f.name) => queue.push({ srcDrive, srcId: f.id, srcPath: f.path, destFolder, name, size: f.size })

// Source A — stamped copies
const colabFiles = await walk(colab, COLAB_ROOT)
const stamped = colabFiles.filter(f => /\/Issued for Tender\//i.test(f.path) || / - ISSUED FOR TENDER\.pdf$/i.test(f.name))
let unclassified = 0
for (const f of stamped) {
  const parts = f.path.split('/') // [COLAB_ROOT, area, discipline?, 'Issued for Tender', file]
  const area = parts[1], disc = parts[2] === 'Issued for Tender' ? null : parts[2]
  const code = f.name.match(/-([A-Z])([A-Z]{3})-\d{4}/)
  const type = code?.[2] ?? null
  if (!type) unclassified++
  // 9 Sep (Marnus + Morné): ONE folder for Sections 4 and 5, mirroring the COLAB tree exactly —
  // a stamped copy lands in the same <area>/<discipline> it has in COLAB.
  void type; void DRAWING
  plan(colab, f, [ROOT, SECTION_4_5, area, disc].filter(Boolean).join('/'))
}

// Source B — the seven deliverables
// 10 Sep 14:00: Marnus curates folders 01–04 and 90 by hand now (he removed the Fluor templates,
// the ESOW .docx and the conformance workbook deliberately). The LIVE DOCUMENTS deliverables are
// therefore no longer carried across by default — only COLAB's stamped copies into 05.
//   --deliverables   also copy the LIVE DOCUMENTS deliverables (the original hand-over behaviour)
const DELIVERABLES = process.argv.includes('--deliverables')
const liveFiles = DELIVERABLES ? await walk(live, LIVE_ROOT) : []
const item = (n) => liveFiles.filter(f => f.path.split('/')[2]?.startsWith(`${n} - `))
const isTemplate = f => /^TEMPLATE/i.test(f.name)
const REF = `${ROOT}/90 Reference - Fluor K480 templates and Doc Matrix (not part of the pack)`
const superseded = []
for (const f of item(1)) plan(live, f, isTemplate(f) ? REF : `${ROOT}/02 PART 2 - Tender Form 2 - Schedule Requirements`)
// Folder 02 is curated by hand since 10 Sep: Fluor's blank "K138 - Section 2 - Pricing Schedule A1"
// is their template (Ulzhan Shona, May 2026), not a PPE deliverable — it lives in Reference; the
// live Schedule A workbook from Blythe (4 Sep) was placed in 02 directly. Nothing from item 2 is
// copied into 02 any more.
for (const f of item(2)) if (isTemplate(f)) plan(live, f, REF)
{
  const a2 = item(3).filter(f => f.path.split('/').length === 4) // files directly in folder 3
  for (const f of a2) {
    if (isTemplate(f)) { plan(live, f, REF); continue }
    if (/-XXXX/.test(f.name)) { superseded.push(f) ; continue }
    // The 1-Sep DRAFT preamble is superseded by 6105AK124-6200-GSPC-0001 Rev C (9 Sep), which
    // combines it with Marnus's Methods of Measurement Rev B. Never carry the draft again.
    if (/Preamble and Method of Measurement - DRAFT/i.test(f.name)) { superseded.push(f); continue }
    if (/ESCH|MTO/i.test(f.name)) { superseded.push(f); continue }   // 10 Sep: cable schedules are issued PDFs in folder 05 now, not Excel in 03
    const sub = /GBOM/.test(f.name) ? 'Bills of Quantities' : 'Preamble and Method of Measurement'
    plan(live, f, `${ROOT}/03 PART 3 - Section 2 - Schedule A - Pricing Schedules/${sub}`)
  }
  // the NUMBERED BoQs and cable schedules only ever existed in item 6's supporting snapshot
  const numbered = liveFiles.filter(f => f.path.includes('/6 - Section 4') && /\.(xlsx|xlsm)$/i.test(f.name) && /(GBOM|ESCH)-\d{4}/.test(f.name))
  for (const f of numbered.filter(f => /GBOM/.test(f.name))) plan(live, f, `${ROOT}/03 PART 3 - Section 2 - Schedule A - Pricing Schedules/Bills of Quantities`)
}
for (const f of item(4)) plan(live, f, isTemplate(f) ? REF : `${ROOT}/04 PART 3 - Section 3 - Technical Scope of Work`)
// Marnus removed folder 05 and the DRAFT Exhibit 3B on 10 Sep. Until a final Exhibit 3B exists
// only the Fluor template goes to Reference; the draft is not carried again.
for (const f of item(5)) if (isTemplate(f)) plan(live, f, REF)
// The 2-Sep DRAFT EDL is superseded (9 Sep) by the live export from CoreReports
// (/api/export-swp006-edl — Fluor's format, vendor rows, PLH for the unreceived, and the
// pack location column). It is placed in 06 and 07 by scripts/tender-site-edl.mjs; the draft
// must not come back on a re-run.
const isDraftEdl = f => /EDL_SWP006_PPE_DRAFT/i.test(f.name)
if (DELIVERABLES) for (const f of item(6).filter(f => f.path.split('/').length === 4 && !isDraftEdl(f))) plan(live, f, isTemplate(f) ? REF : `${ROOT}/${SECTION_4_5}`)
if (DELIVERABLES) for (const f of item(7).filter(f => f.path.split('/').length === 4 && !isDraftEdl(f))) plan(live, f, isTemplate(f) ? REF : `${ROOT}/${SECTION_4_5}`)
// Fluor's own pack + the SDDC form → reference
if (DELIVERABLES) for (const f of await walk(live, 'K480 SWP-006 Power and Balance of Plant/03 SOURCE MATERIAL')) plan(live, f, REF)

// ---- the 31-Aug supporting snapshot vs the stamped set: report only ----
// K038 numbers carry digits in the type code (ED01, ID12) — [A-Z0-9]{4}, or they vanish from the report
const stem = n => n.match(/^(6105A[A-Z0-9]+-\d{4}-[A-Z0-9]{4}-\d{4})/)?.[1] ?? null
const stampedStems = new Set(stamped.map(f => stem(f.name)).filter(Boolean))
const snapshot = liveFiles.filter(f => f.path.includes('/6 - Section 4') && f.path.includes('/Supporting documents/') && /\.pdf$/i.test(f.name))
const notStamped = snapshot.filter(f => stem(f.name) && !stampedStems.has(stem(f.name)))
const k038 = notStamped.filter(f => /^6105AK038/.test(f.name))

// ---- execute ----
console.log(`stamped copies in COLAB: ${stamped.length} (${unclassified} without a type code → treated as drawings)`)
console.log(`deliverable files from LIVE DOCUMENTS: ${queue.length - stamped.length}`)
let copied = 0, skipped = 0, failed = 0
const doCopy = async (q) => {
  q.destFolder = reAddress(q.destFolder)
  const listing = await destListing(q.destFolder)
  // Name only: SharePoint re-saves Office files on copy, so their byte size differs from the
  // source and a size test re-copies (and fails on) every xlsx/docx every run. The site is a
  // curated copy — an existing name is the file. Delete it there to force a fresh copy.
  if (listing.has(q.name) || packNames.has(q.name)) { skipped++; return }
  // …and by DOCUMENT NUMBER too: an issued copy taken from CoreDocs/ENG2 may already sit in the
  // folder under a different file name (other revision suffix). One document, one file.
  const qs = stemOf(q.name)
  if (qs && (packStems.has(qs) || [...listing.keys()].some(n => stemOf(n) === qs))) { skipped++; return }
  const pid = await folderId(q.destFolder)
  if (!WRITE) { console.log(`  would copy  ${q.srcPath.slice(0, 90)}\n         →  ${q.destFolder.slice(ROOT.length + 1)}/`); copied++; return }
  try {
    const r = await call('POST', `/drives/${q.srcDrive}/items/${q.srcId}/copy`, { parentReference: { driveId: out, id: pid }, name: q.name, '@microsoft.graph.conflictBehavior': 'replace' })
    if (r?.monitor) { for (let i = 0; i < 60; i++) { const s = await (await fetch(r.monitor)).json(); if (s.status === 'completed') break; if (s.status === 'failed') throw new Error(`copy failed: ${JSON.stringify(s).slice(0, 200)}`); await new Promise(res => setTimeout(res, 1000)) } }
    copied++
  } catch (e) { failed++; console.log(`  FAILED  ${q.srcPath}: ${e.message.slice(0, 160)}`) }
}
let i = 0
await Promise.all(Array.from({ length: 4 }, async () => { while (i < queue.length) await doCopy(queue[i++]) }))
console.log(`\n${WRITE ? 'copied' : 'would copy'}: ${copied}   already there: ${skipped}   failed: ${failed}`)
if (superseded.length) console.log(`\nSkipped as superseded by a numbered version (un-numbered XXXX drafts):\n  ${superseded.map(f => f.name).join('\n  ')}`)
console.log(`\n31-Aug supporting snapshot under item 6: ${snapshot.length} PDFs, ${notStamped.length} with no stamped copy in COLAB (${k038.length} of them K038 standards/specs). NOT copied — listed for a decision:`)
for (const f of notStamped) console.log(`  ${f.name}`)
