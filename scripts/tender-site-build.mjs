// Build the K480 SWP-006 tender pack structure on a NEW, restricted SharePoint site.
//
//   node scripts/tender-site-build.mjs https://ppetechcoza.sharepoint.com/sites/<site>          dry run
//   node scripts/tender-site-build.mjs https://ppetechcoza.sharepoint.com/sites/<site> --write  create
//
// The site itself is created by Morné in the SharePoint UI (the PPE app holds
// Sites.ReadWrite.All and Files.ReadWrite.All but no Group permission, so it cannot mint a
// site). This script then builds, in the site's Documents library, the
// folder tree below, plus a README at the root. Idempotent: existing folders are left alone.
//
// Structure = Fluor's own RFT Doc Matrix (B9RD, K480), which lists 53 items and marks all
// but SEVEN as already held by Fluor. Folders 01–07 are those seven, in Fluor's order and
// under Fluor's names. Sections 4 and 5 carry their supporting documents beneath the EDL,
// laid out exactly as Vossie's COLAB handover tree is (5 areas × discipline), so a stamped
// "ISSUED FOR TENDER" copy lands in the same place it came from. 08 holds the vendor
// documents Marnus/Josef ruled into the pack (ABB NER, ABB control drawings). 90 is
// reference only and is NOT part of what Fluor receives.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const SITE_URL = process.argv.find(a => a.startsWith('https://'))
if (!SITE_URL) { console.error('usage: node scripts/tender-site-build.mjs <site url> [--write]'); process.exit(1) }
// Default is the site's own Documents library: creating a new library needs Sites.Manage.All,
// which the PPE app does not hold (403 on 9 Sep). Set TENDER_LIBRARY to use another.
const LIBRARY = process.env.TENDER_LIBRARY || 'Documents'
const ROOT = 'K480 SWP-006 Power and Balance of Plant'

const AREAS = ['1. Substations BOP Project Site Wide', '2. Plant Main Substation', '3. Mining Substation', '4. Power Station Substation', '5. Solar PV Substation']
const DISCIPLINES = ['1. Automation', '2. Civil and Structural', '3. Electrical', '4. Instrumentation', '5. Mechanical and Piping']
const SITEWIDE = ['1. Automation General Standards and Specs', '2. Civil and Structural General Standards and Specs', '3. Electrical General Standards and Specs', '4. EHS and Fire Protection General Standards', '5. Mechanical General Standards and Specs', '6. Instrumentation General Standards and Specs']
const byArea = (prefix) => AREAS.flatMap(a => a.startsWith('1.') ? SITEWIDE.map(s => `${prefix}/${a}/${s}`) : DISCIPLINES.map(d => `${prefix}/${a}/${d}`))

const TREE = [
  '01 Tender Form 2 - Schedule Requirements',
  '02 Section 2 - Schedule A - Pricing Schedules',
  '03 Section 2 - Schedule A2 - Unit Prices and BoQ',
  '03 Section 2 - Schedule A2 - Unit Prices and BoQ/Bills of Quantities',
  '03 Section 2 - Schedule A2 - Unit Prices and BoQ/Cable Schedules and MTO',
  '03 Section 2 - Schedule A2 - Unit Prices and BoQ/Preamble and Method of Measurement',
  '04 Section 3 - Exhibit 3A - Technical Scope of Work',
  '05 Section 3 - Exhibit 3B - Company Furnished Material and Equipment',
  '06 Section 4 - Specifications and Plans (EDL)',
  '06 Section 4 - Specifications and Plans (EDL)/Supporting documents',
  ...byArea('06 Section 4 - Specifications and Plans (EDL)/Supporting documents'),
  '07 Section 5 - Drawings (EDL)',
  '07 Section 5 - Drawings (EDL)/Supporting drawings',
  ...byArea('07 Section 5 - Drawings (EDL)/Supporting drawings'),
  '08 Vendor documents referenced in the pack',
  '08 Vendor documents referenced in the pack/ABB',
  '08 Vendor documents referenced in the pack/Orient',
  '90 Reference - Fluor K480 templates and Doc Matrix (not part of the pack)',
]

const README = `K480 - SWP 006 - POWER / BALANCE OF PLANT
FINAL TENDER PACK - PPE TECHNOLOGIES DELIVERABLES TO FLUOR
==========================================================
This site holds ONLY the final documents PPE Technologies hands to Fluor for the
SWP-006 addendum to the K480 RFT. Working copies stay in the K138 - Balance of Plant
site (COLAB and LIVE DOCUMENTS); nothing is worked on here.

Package name per Bing Mu (Fluor), 28 Aug 2026: "K480 - SWP 006 - Power / Balance of Plant".
OHL scope is excluded from this Addendum (Blythe Tait, 28 Aug 2026).

Fluor's B9RD RFT Doc Matrix lists 53 items; Fluor holds 46. PPE owes SEVEN, folders 01-07:
  01  Tender Form 2 - Schedule Requirements
  02  Section 2 - Schedule A - Pricing Schedules
  03  Section 2 - Schedule A2 - Unit Prices and BoQ   (BoQs, cable schedules, cable MTO, preamble)
  04  Section 3 - Exhibit 3A - Technical Scope of Work
  05  Section 3 - Exhibit 3B - Company Furnished Material and Equipment
  06  Section 4 - Specifications and Plans (EDL)      EDL workbook + supporting documents
  07  Section 5 - Drawings (EDL)                      same EDL workbook + supporting drawings
  08  Vendor documents referenced in the pack (ABB NER datasheet and GA, ABB control drawings)
  90  Reference - Fluor's templates and Doc Matrix. NOT part of the pack.

Supporting documents under 06 and 07 are filed by substation and discipline, in the same
order as the COLAB handover tree, and are the stamped "ISSUED FOR TENDER" copies.

Access: Morne Cronje and Marnus Meyer (owners). Others - internal or Fluor - are added by
name, deliberately, when the pack is ready for them.
`

const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, G = 'https://graph.microsoft.com/v1.0'
const call = async (method, u, body) => { const r = await fetch(u.startsWith('http') ? u : G + u, { method, headers: H, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }); if (!r.ok) throw new Error(`${r.status} ${method} ${u.slice(0, 120)}\n${await r.text()}`); return r.status === 204 ? null : r.json() }

const u = new URL(SITE_URL)
const site = await call('GET', `/sites/${u.hostname}:${u.pathname}`)
console.log(`site: ${site.displayName}  ${site.webUrl}`)
let drives = (await call('GET', `/sites/${site.id}/drives?$select=id,name`)).value
let lib = drives.find(d => d.name === LIBRARY)
if (!lib) {
  console.log(`library "${LIBRARY}": ${WRITE ? 'creating' : 'would create'}`)
  if (WRITE) {
    await call('POST', `/sites/${site.id}/lists`, { displayName: LIBRARY, list: { template: 'documentLibrary' } })
    drives = (await call('GET', `/sites/${site.id}/drives?$select=id,name`)).value
    lib = drives.find(d => d.name === LIBRARY)
  }
} else console.log(`library "${LIBRARY}": exists`)

const enc = p => p.split('/').map(encodeURIComponent).join('/')
const exists = async (p) => { try { await call('GET', `/drives/${lib.id}/root:/${enc(p)}`); return true } catch (e) { if (String(e.message).startsWith('404')) return false; throw e } }
async function mkdir(p) {
  if (!lib) { console.log(`  would create  ${p}`); return }
  if (await exists(p)) { console.log(`  exists        ${p}`); return }
  if (!WRITE) { console.log(`  would create  ${p}`); return }
  const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
  const name = p.slice(p.lastIndexOf('/') + 1)
  await call('POST', parent ? `/drives/${lib.id}/root:/${enc(parent)}:/children` : `/drives/${lib.id}/root/children`, { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
  console.log(`  created       ${p}`)
}
await mkdir(ROOT)
for (const p of TREE) await mkdir(`${ROOT}/${p}`)
if (lib && WRITE) {
  await call('PUT', `/drives/${lib.id}/root:/${enc(ROOT + '/00 READ ME FIRST.txt')}:/content`, README)
  console.log('  written       00 READ ME FIRST.txt')
} else console.log('  would write   00 READ ME FIRST.txt')
console.log(`\n${WRITE ? 'done' : 'dry run only — add --write to create'}: ${1 + TREE.length} folders`)
