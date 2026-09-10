// Stamp-and-copy the documents whose file was FOUND by the site-wide search rather than by
// the register link — input is %TEMP%/claude/k480/tender-issued-missing-picks.json (one picked
// file per document: LIVE Rev 0+ > returned TO VENDOR > received). Same stamp, same placement
// rule, same skip-by-number as tender-site-stamp-copy.ts. Sources are never written to.
//   npx tsx scripts/tender-site-stamp-picks.ts [--write]
import fs from 'node:fs'
import { stampIssuedForTender, tenderStampDate, tenderCopyName } from '../lib/prelim/tender-stamp'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const INPUT = process.argv.find(a => a.startsWith('--input='))?.slice(8) ?? 'C:/Users/mornec/AppData/Local/Temp/claude/k480/tender-issued-missing-picks.json'
const DST_SITE = 'https://ppetechcoza.sharepoint.com/sites/K480SWP-006TenderPack'
const ROOT = 'K480 SWP-006 Power and Balance of Plant'
const DRAWING = /^(LAY|GAD|SEC|DIA|DTL|PFD|FND|PLN|SLD)$/
const AREA: Record<string, string> = { '0000': '1. General Standards and Specifications', '9134': '1. General Standards and Specifications', '6200': '2. Main Consumer (Plant Main) Substation', '6212': '2. Main Consumer (Plant Main) Substation', '6260': '2. Main Consumer (Plant Main) Substation', '6243': '2. Main Consumer (Plant Main) Substation', '6253': '2. Main Consumer (Plant Main) Substation', '6254': '2. Main Consumer (Plant Main) Substation', '6256': '2. Main Consumer (Plant Main) Substation', '6262': '2. Main Consumer (Plant Main) Substation', '6263': '2. Main Consumer (Plant Main) Substation', '6264': '2. Main Consumer (Plant Main) Substation', '6286': '3. Mining Substation', '6242': '4. Main Intake (Power Station) Substation', '6251': '4. Main Intake (Power Station) Substation', '6241': '5. Solar PV Substation', '6290': '5. Solar PV Substation', '6292': '5. Solar PV Substation' }
const SECTION_4_5 = '05 PART 3 - Sections 4 & 5 - Specifications, Plans & Drawings (EDL)'
const DISC: Record<string, string> = { C: '2. Civil and Structural', S: '2. Civil and Structural', W: '2. Civil and Structural', E: '3. Electrical', F: '1. Automation', A: '1. Automation', I: '4. Instrumentation', M: '5. Mechanical and Piping', P: '5. Mechanical and Piping' }
const SITEWIDE: Record<string, string> = { C: '2. Civil and Structural General Standards and Specs', S: '2. Civil and Structural General Standards and Specs', W: '2. Civil and Structural General Standards and Specs', E: '5. Electrical General Standards and Specs', F: '1. Control & Automation General Standards and Specs', A: '1. Control & Automation General Standards and Specs', I: '6. Instrumentation General Standards and Specs', M: '4. Mechanical General Standards and Specs', P: '4. Mechanical General Standards and Specs' }
const stemOf = (s: string) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? s.trim()).toUpperCase()
function placement(docNo: string, k038SiteWide = true) {
  const m = docNo.match(/6105A[A-Z0-9]+-(\d{4})-([A-Z])([A-Z0-9]{3})-\d{4}/i)
  const code = m?.[1] ?? '', letter = (m?.[2] ?? 'E').toUpperCase(), type = (m?.[3] ?? '').toUpperCase()
  const section = DRAWING.test(type) ? 5 : 4 // log only; one folder for both sections since 9 Sep
  const base = SECTION_4_5
  let area = AREA[code]
  if (code === '0100') area = k038SiteWide && /^6105AK038/i.test(docNo) ? '1. General Standards and Specifications' : '1. General Standards and Specifications'
  if (!area) area = '1. General Standards and Specifications'
  const disc = area.startsWith('1.') ? (SITEWIDE[letter] ?? SITEWIDE.E) : (DISC[letter] ?? DISC.E)
  return { folder: `${ROOT}/${base}/${area}/${disc}`, section }
}

async function main() {
  const picks: any[] = JSON.parse(fs.readFileSync(INPUT, 'utf8')).filter((p: any) => p.pick)
  const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token as string
  const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
  const retry = async <T,>(fn: () => Promise<T>, n = 4): Promise<T> => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n || /^4(0[0-9]|1[0-9])\b/.test(String((e as Error).message))) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))) } } }
  const g = (u: string) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} GET ${u.slice(0, 100)}`); return r.json() })
  const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/')
  const dstSite = await g(`/sites/${new URL(DST_SITE).hostname}:${new URL(DST_SITE).pathname}`)
  const out = (await g(`/sites/${dstSite.id}/drives?$select=id,name`)).value.find((x: any) => x.name === 'Documents').id as string
  const inSite = new Set<string>()
  async function walk(p: string) { let u = `/drives/${out}/root:/${enc(p)}:/children?$select=name,folder&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(`${p}/${k.name}`); else inSite.add(stemOf(k.name)) } u = j['@odata.nextLink'] } }
  await walk(ROOT)
  const driveCache = new Map<string, string>()
  async function driveId(site: string, lib: string) { const k = `${site}/${lib}`; if (!driveCache.has(k)) { const s = await g(`/sites/ppetechcoza.sharepoint.com:/sites/${site}`); const d = (await g(`/sites/${s.id}/drives?$select=id,name`)).value.find((x: any) => x.name === lib); driveCache.set(k, d?.id ?? '') } return driveCache.get(k)! }
  const folderIds = new Map<string, string>()
  async function folderId(path: string): Promise<string> {
    if (folderIds.has(path)) return folderIds.get(path)!
    try { const j = await g(`/drives/${out}/root:/${enc(path)}?$select=id`); folderIds.set(path, j.id); return j.id } catch (e) { if (!String((e as Error).message).startsWith('404')) throw e }
    const parent = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1)
    const pid = await folderId(parent)
    const r = await fetch(`${G}/drives/${out}/items/${pid}/children`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) })
    if (!r.ok) throw new Error(`${r.status} mkdir ${path}`); const j = await r.json(); folderIds.set(path, j.id); return j.id
  }
  async function upload(folder: string, name: string, bytes: Uint8Array) {
    const pid = await folderId(folder)
    const s = await fetch(`${G}/drives/${out}/items/${pid}:/${encodeURIComponent(name)}:/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name } }) })
    if (!s.ok) throw new Error(`${s.status} uploadSession ${name}`)
    const { uploadUrl } = await s.json(); const CH = 10 * 320 * 1024
    for (let off = 0; off < bytes.length; off += CH) { const end = Math.min(off + CH, bytes.length); await retry(async () => { const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(end - off), 'Content-Range': `bytes ${off}-${end - 1}/${bytes.length}` }, body: bytes.slice(off, end) }); if (!r.ok) throw new Error(`${r.status} upload chunk ${name}`); return r }) }
  }
  const date = tenderStampDate()
  let done = 0, skipped = 0, failed = 0
  const results: any[] = []
  const work = picks.slice()
  const worker = async () => {
    while (work.length) {
      const p = work.shift()!
      // a pick may name its own destination (folder 08 vendor documents), else the area/discipline rule
      const { folder, section } = p.folder ? { folder: `${ROOT}/${p.folder}`, section: 0 } : placement(p.docNo)
      const rec: any = { docNo: p.docNo, package: p.originator === 'PPE' ? 'K124' : p.package, section, folder: folder.slice(ROOT.length + 1), source: `${p.pick.site}/${p.pick.lib}${p.pick.path}`, rev: p.pick.rev }
      if (inSite.has(stemOf(p.docNo))) { skipped++; rec.result = 'already in site'; results.push(rec); continue }
      if (!WRITE) { console.log(`  S${section}  ${p.docNo.padEnd(27)} rev ${String(p.pick.rev).padEnd(2)} ← ${rec.source.slice(0, 80)}\n        → ${rec.folder}`); done++; rec.result = 'would copy'; results.push(rec); continue }
      try {
        const drv = await driveId(p.pick.site, p.pick.lib); if (!drv) throw new Error(`library ${p.pick.site}/${p.pick.lib} not found`)
        const r = await retry(async () => { const r = await fetch(`${G}/drives/${drv}/root:/${enc(p.pick.path.replace(/^\//, ''))}:/content`, { headers: H }); if (!r.ok) throw new Error(`${r.status} download ${p.docNo}`); return r })
        const bytes = new Uint8Array(await r.arrayBuffer())
        const stamped = await stampIssuedForTender(bytes, date)
        const outName = tenderCopyName(/\.pdf$/i.test(p.pick.name) ? p.pick.name.replace(/\.PDF$/, '.pdf') : `${p.pick.name}.pdf`)
        await upload(folder, outName, stamped.bytes)
        inSite.add(stemOf(p.docNo)); done++; rec.result = 'stamped+copied'; rec.file = outName; rec.pages = stamped.pages
        console.log(`  ok  S${section}  ${p.docNo.padEnd(27)} rev ${String(p.pick.rev).padEnd(2)} ${stamped.pages}p  ${outName.slice(0, 60)}`)
      } catch (e) { failed++; rec.result = 'FAILED'; rec.error = String((e as Error).message).slice(0, 200); console.log(`  FAILED  ${p.docNo}: ${rec.error}`) }
      results.push(rec)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  console.log(`\n${WRITE ? 'stamped and copied' : 'would copy'}: ${done}   already in site: ${skipped}   failed: ${failed}`)
  fs.writeFileSync('C:/Users/mornec/AppData/Local/Temp/claude/k480/tender-issued-missing-copied.json', JSON.stringify(results, null, 1))
}
main().catch(e => { console.error(e); process.exit(1) })
