// STAMP-AND-COPY the ISSUED tender documents into the K480 SWP-006 tender pack site.
//
//   npx tsx scripts/tender-site-stamp-copy.ts            dry run — where each one would go
//   npx tsx scripts/tender-site-stamp-copy.ts --write    download → stamp → upload
//
// Input: %TEMP%/claude/k480/tender-issued-resolved.json, written by
// corereports-app/scripts/_tender-issued-resolve.ts (the Master Register's issued tender rows,
// each resolved to its CoreDocs file or to the 31-Aug LIVE snapshot). Takes every row that is
// NOT already in the site and resolves to a PDF. Nothing is written back to CoreDocs, COLAB or
// LIVE DOCUMENTS: the stamp goes onto the copy, in the site, in one pass (Morné, 9 Sep:
// "stamp during, not after"). Skips by DOCUMENT NUMBER, so a document already in the site
// under another file name is not added twice.
//
// Placement = the same rule as the stamped prelim copies:
//   Section 5 (drawings) for LAY GAD SEC DIA DTL PFD FND PLN SLD; Section 4 for everything else
//   (a K038 code with digits, ED24 / ID12, is a spec → Section 4).
//   Area from the 4-digit area code, mapped the way the team's own COLAB tree files them;
//   discipline from the first letter of the type code.
import fs from 'node:fs'
import { stampIssuedForTender, tenderStampDate, tenderCopyName } from '../lib/prelim/tender-stamp'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const INPUT = 'C:/Users/mornec/AppData/Local/Temp/claude/k480/tender-issued-resolved.json'
const OUTPUT = 'C:/Users/mornec/AppData/Local/Temp/claude/k480/tender-issued-stamped.json'
const DST_SITE = 'https://ppetechcoza.sharepoint.com/sites/K480SWP-006TenderPack'
const SRC_SITE = 'https://ppetechcoza.sharepoint.com/sites/K138-BalanceofPlant'
const ROOT = 'K480 SWP-006 Power and Balance of Plant'
const DRAWING = /^(LAY|GAD|SEC|DIA|DTL|PFD|FND|PLN|SLD)$/

// Area code → the team's own folder (derived from where the 239 stamped copies sit in COLAB;
// 6243 is Siemens' third 220 kV substation and is filed with Plant Main, as 6253/6256 are;
// 6260 sits in the 626x Plant Main run, 6290 beside 6292 Solar PV).
const AREA: Record<string, string> = {
  '0000': '1. Substations BOP Project Site Wide', '9134': '1. Substations BOP Project Site Wide',
  '6200': '2. Plant Main Substation', '6212': '2. Plant Main Substation', '6260': '2. Plant Main Substation', '6243': '2. Plant Main Substation', '6253': '2. Plant Main Substation', '6254': '2. Plant Main Substation', '6256': '2. Plant Main Substation', '6262': '2. Plant Main Substation', '6263': '2. Plant Main Substation', '6264': '2. Plant Main Substation',
  '6286': '3. Mining Substation',
  '6242': '4. Power Station Substation', '6251': '4. Power Station Substation',
  '6241': '5. Solar PV Substation', '6290': '5. Solar PV Substation', '6292': '5. Solar PV Substation',
}
const DISC: Record<string, string> = { C: '2. Civil and Structural', S: '2. Civil and Structural', W: '2. Civil and Structural', E: '3. Electrical', F: '1. Automation', A: '1. Automation', I: '4. Instrumentation', M: '5. Mechanical and Piping', P: '5. Mechanical and Piping' }
const SITEWIDE: Record<string, string> = { C: '2. Civil and Structural General Standards and Specs', S: '2. Civil and Structural General Standards and Specs', W: '2. Civil and Structural General Standards and Specs', E: '3. Electrical General Standards and Specs', F: '1. Automation General Standards and Specs', A: '1. Automation General Standards and Specs', I: '6. Instrumentation General Standards and Specs', M: '5. Mechanical General Standards and Specs', P: '5. Mechanical General Standards and Specs' }

type Doc = { docNo: string; originator: string; vendor: string; package: string; area: string; discipline: string; type: string; title: string; inSite: boolean; kind: string; fileLink: string | null; revision: string | null; altSource: { kind: string; path?: string } | null }
// Vendor files write the type code with a hyphen after the discipline letter ("E-DIA-0001"
// for EDIA-0001); the stem drops that hyphen so the file and the register number agree.
const stemOf = (s: string) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? s.trim()).toUpperCase()

function placement(d: Doc): { folder: string; section: 4 | 5; note?: string } {
  const m = d.docNo.match(/6105A[A-Z0-9]+-(\d{4})-([A-Z])([A-Z0-9]{3})-\d{4}/i)
  const code = m?.[1] ?? '', letter = (m?.[2] ?? 'E').toUpperCase(), type = (m?.[3] ?? '').toUpperCase()
  const section: 4 | 5 = DRAWING.test(type) ? 5 : 4
  const base = section === 5 ? '07 Section 5 - Drawings (EDL)/Supporting drawings' : '06 Section 4 - Specifications and Plans (EDL)/Supporting documents'
  let area = AREA[code], note: string | undefined
  if (code === '0100') area = /site ?wide|project/i.test(d.area) || /^6105AK038/i.test(d.docNo) ? '1. Substations BOP Project Site Wide' : '2. Plant Main Substation'
  if (!area) { area = '1. Substations BOP Project Site Wide'; note = `area code ${code} not in the map — filed Site Wide` }
  const disc = area.startsWith('1.') ? (SITEWIDE[letter] ?? SITEWIDE.E) : (DISC[letter] ?? DISC.E)
  return { folder: `${ROOT}/${base}/${area}/${disc}`, section, note }
}

async function main() {
  const all: Doc[] = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
  const todo = all.filter(d => !d.inSite && (d.kind === 'pdf' || d.altSource?.kind === 'live-snapshot'))
  console.log(`candidates: ${todo.length}  (from CoreDocs ${todo.filter(d => d.kind === 'pdf').length}, from the LIVE snapshot ${todo.filter(d => d.kind !== 'pdf').length}; PPE ${todo.filter(d => d.originator === 'PPE').length}, vendor ${todo.filter(d => d.originator === 'Vendor').length})`)

  const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token as string
  const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
  const retry = async <T,>(fn: () => Promise<T>, n = 4): Promise<T> => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n || /^4(0[0-9]|1[0-9])\b/.test(String((e as Error).message))) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))) } } }
  const g = (u: string) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} GET ${u.slice(0, 100)}`); return r.json() })
  const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/')
  const dstSite = await g(`/sites/${new URL(DST_SITE).hostname}:${new URL(DST_SITE).pathname}`)
  const out = (await g(`/sites/${dstSite.id}/drives?$select=id,name`)).value.find((x: any) => x.name === 'Documents').id as string
  const srcSite = await g(`/sites/${new URL(SRC_SITE).hostname}:${new URL(SRC_SITE).pathname}`)
  const live = (await g(`/sites/${srcSite.id}/drives?$select=id,name`)).value.find((x: any) => x.name === 'LIVE DOCUMENTS').id as string

  // A document sitting in an OPEN prelim session without a "ready for tender" call is under
  // review (or recalled — scripts/prelim-recall.mjs) and must not be put in the pack by this
  // pass, whatever the register says about it. The reviewer's stamp is what brings it in.
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: underReview } = await sb.from('prelim_document').select('document_number, routing, prelim_session!inner(status)').eq('prelim_session.status', 'open').limit(5000)
  const held = new Set((underReview ?? []).filter((r: any) => r.document_number && r.routing !== 'ready_for_tender').map((r: any) => stemOf(r.document_number)))
  console.log(`held back — in an open prelim session and not yet Ready for tender: ${held.size}`)

  // what the site already holds, by document number (re-read now: the morning copy added 263)
  const inSite = new Set<string>()
  async function walk(p: string) { let u = `/drives/${out}/root:/${enc(p)}:/children?$select=name,folder&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(`${p}/${k.name}`); else inSite.add(stemOf(k.name)) } u = j['@odata.nextLink'] } }
  await walk(ROOT)

  const folderIds = new Map<string, string>()
  async function folderId(path: string): Promise<string> {
    if (folderIds.has(path)) return folderIds.get(path)!
    try { const j = await g(`/drives/${out}/root:/${enc(path)}?$select=id`); folderIds.set(path, j.id); return j.id } catch (e) { if (!String((e as Error).message).startsWith('404')) throw e }
    const parent = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1)
    const pid = await folderId(parent)
    const r = await fetch(`${G}/drives/${out}/items/${pid}/children`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) })
    if (!r.ok) throw new Error(`${r.status} mkdir ${path}`)
    const j = await r.json(); folderIds.set(path, j.id); console.log(`  created folder ${path.slice(ROOT.length + 1)}`); return j.id
  }
  const shareId = (l: string) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const bytesOf = async (driveId: string, itemId: string, who: string) => { const r = await retry(async () => { const r = await fetch(`${G}/drives/${driveId}/items/${itemId}/content`, { headers: H }); if (!r.ok) throw new Error(`${r.status} download ${who}`); return r }); return new Uint8Array(await r.arrayBuffer()) }
  // The CoreDocs link names a REVISION ("…_A.pdf"). When Document Control has since replaced the
  // file with a later revision the old path is gone and the shares API answers 403. Fall back
  // to searching that same library for the newest PDF of the document number, so the copy
  // takes the CURRENT issued file rather than failing on a stale pointer.
  const driveByUrl = new Map<string, string>()
  async function currentRevisionInLibrary(d: Doc): Promise<{ bytes: Uint8Array; name: string } | null> {
    const u = new URL(d.fileLink!.split('?')[0])
    const m = u.pathname.match(/^(\/sites\/[^/]+)\/([^/]+)\//); if (!m) return null
    const key = `${m[1]}/${m[2]}`
    if (!driveByUrl.has(key)) { const s = await g(`/sites/${u.hostname}:${m[1]}`); const lib = decodeURIComponent(m[2]); const dr = (await g(`/sites/${s.id}/drives?$select=id,name`)).value.find((x: any) => x.name === lib); driveByUrl.set(key, dr?.id ?? '') }
    const drv = driveByUrl.get(key); if (!drv) return null
    const hits = ((await g(`/drives/${drv}/root/search(q='${d.docNo}')?$select=id,name,lastModifiedDateTime,file`)).value ?? [])
      .filter((h: any) => h.file && h.name.toUpperCase().startsWith(d.docNo.toUpperCase()) && /\.pdf$/i.test(h.name))
      .sort((a: any, b: any) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)))
    if (!hits.length) return null
    return { bytes: await bytesOf(drv, hits[0].id, d.docNo), name: hits[0].name }
  }
  let snapshot: Map<string, string> | null = null
  async function fromSnapshot(d: Doc): Promise<{ bytes: Uint8Array; name: string } | null> {
    if (!snapshot) { snapshot = new Map(); const base = 'K480 SWP-006 Power and Balance of Plant/01 PPE DELIVERABLES - the seven outstanding items/6 - Section 4 - Specifications and Plans (EDL)/Supporting documents'; const w = async (p: string) => { let u = `/drives/${live}/root:/${enc(p)}:/children?$select=name,folder&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await w(`${p}/${k.name}`); else if (/\.pdf$/i.test(k.name)) snapshot!.set(stemOf(k.name), `${p}/${k.name}`) } u = j['@odata.nextLink'] } }; await w(base) }
    const p = snapshot.get(stemOf(d.docNo)); if (!p) return null
    const r = await retry(async () => { const r = await fetch(`${G}/drives/${live}/root:/${enc(p)}:/content`, { headers: H }); if (!r.ok) throw new Error(`${r.status} download ${d.docNo}`); return r })
    return { bytes: new Uint8Array(await r.arrayBuffer()), name: p.slice(p.lastIndexOf('/') + 1) }
  }
  async function download(d: Doc): Promise<{ bytes: Uint8Array; name: string; via: string }> {
    if (d.kind === 'pdf' && d.fileLink) {
      try {
        const link = d.fileLink.split('?')[0]
        const meta = await g(`/shares/${shareId(link)}/driveItem?$select=id,name,size,parentReference`)
        return { bytes: await bytesOf(meta.parentReference.driveId, meta.id, d.docNo), name: meta.name, via: 'link' }
      } catch (e) {
        const cur = await currentRevisionInLibrary(d); if (cur) return { ...cur, via: 'library search (link was stale)' }
        const snap = await fromSnapshot(d); if (snap) return { ...snap, via: 'LIVE snapshot (link was stale, not in library)' }
        throw e
      }
    }
    const snap = await fromSnapshot(d); if (snap) return { ...snap, via: 'LIVE snapshot' }
    throw new Error(`no source for ${d.docNo}`)
  }
  async function upload(folder: string, name: string, bytes: Uint8Array) {
    const pid = await folderId(folder)
    const s = await fetch(`${G}/drives/${out}/items/${pid}:/${encodeURIComponent(name)}:/createUploadSession`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name } }) })
    if (!s.ok) throw new Error(`${s.status} uploadSession ${name}`)
    const { uploadUrl } = await s.json()
    const CH = 10 * 320 * 1024
    for (let off = 0; off < bytes.length; off += CH) {
      const end = Math.min(off + CH, bytes.length)
      const r = await retry(async () => { const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(end - off), 'Content-Range': `bytes ${off}-${end - 1}/${bytes.length}` }, body: bytes.slice(off, end) }); if (!r.ok) throw new Error(`${r.status} upload chunk ${name}`); return r })
      void r
    }
  }

  const date = tenderStampDate()
  const results: any[] = []
  let done = 0, skipped = 0, failed = 0
  const work = todo.slice()
  const worker = async () => {
    while (work.length) {
      const d = work.shift()!
      const { folder, section, note } = placement(d)
      const rec: any = { docNo: d.docNo, originator: d.originator, package: d.package, section, folder: folder.slice(ROOT.length + 1), note }
      if (held.has(stemOf(d.docNo))) { skipped++; rec.result = 'held — under review in prelim'; results.push(rec); continue }
      if (inSite.has(stemOf(d.docNo))) { skipped++; rec.result = 'already in site'; results.push(rec); continue }
      if (!WRITE) { rec.result = 'would stamp+copy'; results.push(rec); done++; console.log(`  S${section}  ${d.docNo.padEnd(28)} ${d.originator.padEnd(6)} → ${folder.slice(ROOT.length + 1)}${note ? `   ⚠ ${note}` : ''}`); continue }
      try {
        const { bytes, name, via } = await download(d)
        if (via !== 'link' && via !== 'LIVE snapshot') rec.via = via
        const stamped = await stampIssuedForTender(bytes, date)
        const outName = tenderCopyName(name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`)
        await upload(folder, outName, stamped.bytes)
        inSite.add(stemOf(d.docNo)); done++
        rec.result = 'stamped+copied'; rec.file = outName; rec.pages = stamped.pages; rec.bytes = stamped.bytes.length
        console.log(`  ok  S${section}  ${d.docNo.padEnd(28)} ${d.originator.padEnd(6)} ${stamped.pages}p  ${outName.slice(0, 60)}${rec.via ? `   [${rec.via}]` : ''}`)
      } catch (e) { failed++; rec.result = 'FAILED'; rec.error = String((e as Error).message).slice(0, 200); console.log(`  FAILED  ${d.docNo}: ${rec.error}`) }
      results.push(rec)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  console.log(`\n${WRITE ? 'stamped and copied' : 'would stamp and copy'}: ${done}   already in site: ${skipped}   failed: ${failed}`)
  const bySec = (s: number) => results.filter(r => r.section === s && /copied|would/.test(r.result)).length
  console.log(`  Section 4 (documents): ${bySec(4)}   Section 5 (drawings): ${bySec(5)}`)
  const notes = results.filter(r => r.note); if (notes.length) console.log(`  ⚠ ${notes.length} filed by fallback rule — see JSON`)
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
