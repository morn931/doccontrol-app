// Act on Johan's feedback to the K038 B-list review (email "K038 - B List", 4 Sep 2026).
//
// Johan wrote his instruction per document in column M "JB: Feedback" of the "8 All
// decisions" tab. This script turns those, plus the review's own decisions where he was
// silent, into a plan against THREE targets and — with --write — applies it:
//   CDDL   the live Engineering CDDL workbook (Construct Doc Register): append the kept rows
//          that are not there, tick "To be Issued for Tender" on the ones that are, set the
//          level-of-effort status, correct the three entries he named
//   ENG2   the B-list batch folders in the ENG2 discipline libraries: rename files to match
//          the register, move archived ones into an Archive subfolder, note PDFs
//   REG    cddl_carryover in CoreDocs: status done / skipped per row
// Dry run by default; every action is listed with what it found. --write applies.
import fs from 'node:fs'
import openpyxl from 'node:module'
import XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
void openpyxl
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('='); const k = t.slice(0, i).trim()
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const WRITE = process.argv.includes('--write')
const S = (v) => String(v ?? '').trim()
const K = (v) => S(v).toUpperCase().replace(/[\s_]/g, '')
const retry = async (fn, n = 5) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 2500 * (i + 1))) } } }
const tok = (await retry(async () => (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
})).json())).access_token
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }
const G = 'https://graph.microsoft.com/v1.0'
const gcall = async (method, u, body) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(`${method} ${u.slice(0, 90)} -> ${r.status} ${(await r.text()).slice(0, 200)}`); return r.status === 204 ? null : r.json() })
const get = (u) => gcall('GET', u)

// ── 1. the review + Johan's feedback ─────────────────────────────────────────────────
const WB = String.raw`C:\Users\mornec\AppData\Local\Temp\claude\k480\blist-mail\K038 B-List - decisions for the CDDL - feedback.xlsx`
const wb = XLSX.read(fs.readFileSync(WB), { type: 'buffer' })
const all = XLSX.utils.sheet_to_json(wb.Sheets['8 All decisions'], { defval: '' }).map(r => ({
  ref: S(r['Ref']), section: S(r['Section']), docno: S(r['Document number']), title: S(r['Title']), pkg: S(r['Target package']),
  decision: S(r['Decision']), aconex: S(r['Aconex status']), oncddl: S(r['Already on CDDL?']), held: S(r['Held back?']),
  numprob: S(r['Number problem']), note: S(r['Note']), file: S(r['File']), jb: S(r['JB: Feedback']),
}))
// paste-ready rows from sheet 1 (header on row 2) and tick rows from sheet 2, keyed by number
const sheetRows = (name) => { const a = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }); const hdr = a[1].map(S); return a.slice(2).filter(r => S(r[4])).map(r => Object.fromEntries(hdr.map((h, i) => [h || `_${i}`, r[i]]))) }
const paste = new Map(sheetRows('1 Paste into CDDL').map(r => [K(r['RDMC Document Number']), r]))
const tick = new Map(sheetRows('2 Already on CDDL - tick only').map(r => [K(r['RDMC Document Number']), r]))
console.log(`review rows ${all.length} · sheet 1 paste ${paste.size} · sheet 2 tick ${tick.size}`)

// classify Johan's instruction
const LOE = 'CAN - Cancelled - Level of Effort'
const kind = (r) => {
  const j = r.jb.toLowerCase()
  if (!j) return r.decision === 'Cancel' ? 'cancel' : 'as-decided'
  if (j.startsWith('archive')) return 'archive'
  if (j.startsWith('keep on cddl')) return j.includes('search for pdf') ? 'loe+pdf' : 'loe'
  if (j.startsWith('search for pdf')) return 'pdf'
  if (j.startsWith('keep register name')) return 'rename-to-register'
  if (j.startsWith('new doc request')) return 'new-request'
  if (j.startsWith('new file name and register entry')) return 'new-number'
  if (j.startsWith('change register name')) return 'fix-register'
  if (j.startsWith('everything is wrong')) return 'fix-both'
  if (j === 'keep') return 'keep'
  return 'unclassified'
}
for (const r of all) r.kind = kind(r)
const tally = (xs, f) => Object.entries(xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])
console.log('by instruction:', tally(all, r => r.kind).map(([k, v]) => `${k} ${v}`).join(' · '))
const uncl = all.filter(r => r.kind === 'unclassified'); if (uncl.length) { console.log('⚠ UNCLASSIFIED feedback:'); for (const r of uncl) console.log(`   ${r.ref} "${r.jb}"`) }

// the explicit new numbers Johan gave
const NEW_NUMBER = {
  'CO-220': { docno: '6105AK124-6251-CLAY-0027', title: 'Load Bank - Loadbanks 25 MVA Combination and Connections - Layout Options' },
  'CO-221': { docno: '6105AK124-6251-SGAD-0001', title: 'Load Bank - 11kV Loadbank 40ft Container 4125 kVA - Section Views GA' },
  'CO-244': { docno: '6105AK124-6243-MGAD-0011' },
  'CO-100': { docno: '6105AK124-6240-EGAD-0001' },
}

// ── 2. the live CDDL ─────────────────────────────────────────────────────────────────
const { D, I } = JSON.parse(fs.readFileSync(String.raw`C:\Users\mornec\AppData\Local\Temp\claude\k480\cddl-item.json`, 'utf8'))
const WBK = `/drives/${D}/items/${I}/workbook`, SHEET = `worksheets('Construct Doc Register')`
const sess = await gcall('POST', `${WBK}/createSession`, { persistChanges: WRITE })
const HS = { ...H, 'workbook-session-id': sess.id }
const wcall = async (method, u, body) => retry(async () => { const r = await fetch(G + u, { method, headers: HS, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(`${method} ${u.slice(0, 90)} -> ${r.status} ${(await r.text()).slice(0, 200)}`); return r.status === 204 ? null : r.json() })
const used = await wcall('GET', `${WBK}/${SHEET}/usedRange(valuesOnly=true)?$select=rowCount`)
const last = used.rowCount
const head = (await wcall('GET', `${WBK}/${SHEET}/range(address='A1:V1')?$select=values`)).values[0].map(S)
const col = (name) => { const i = head.findIndex(h => h.toLowerCase() === name.toLowerCase()); if (i < 0) throw new Error(`no column "${name}"`); return String.fromCharCode(65 + i) }
const C = { doc: col('RDMC Document Number'), status: col('Aconex Status'), tender: col('To be Issued for Tender'), title: col('Major Description') }
const colVals = async (letter) => (await wcall('GET', `${WBK}/${SHEET}/range(address='${letter}1:${letter}${last}')?$select=values`)).values.map(v => v[0])
const [docs, statuses, tenders, titles] = await Promise.all([colVals(C.doc), colVals(C.status), colVals(C.tender), colVals(C.title)])
const cddl = new Map(); for (let i = 1; i < last; i++) if (K(docs[i])) cddl.set(K(docs[i]), { row: i + 1, status: S(statuses[i]), tender: tenders[i], title: S(titles[i]) })
// The tender tick is ONLY for rows the review decided "CDDL + tender". A kept row is not a
// tender row; the first dry run ticked all 124 and that would have put 90 documents into
// the tender pack that nobody asked for.
const wantsTender = (r) => r.decision === 'CDDL + tender'
console.log(`CDDL: ${last} rows, ${cddl.size} numbered · columns ${JSON.stringify(C)}`)

// ── 3. ENG2 — the B-list batch folders ───────────────────────────────────────────────
const BATCHES = ['K038 Carry-over (B list) - 2026-09-02', 'Recovered from Aconex - 2026-09-02']
const site = await get('/sites/ppetechcoza.sharepoint.com:/sites/ENG2')
const drives = (await get(`/sites/${site.id}/drives?$select=id,name`)).value ?? []
const eng2 = []   // every file in the batch folders
for (const dr of drives) {
  const kids = (await get(`/drives/${dr.id}/root/children?$top=999&$select=id,name,folder`)).value ?? []
  for (const b of kids.filter(k => k.folder && BATCHES.includes(k.name))) {
    const files = (await get(`/drives/${dr.id}/items/${b.id}/children?$top=999&$select=id,name,folder,webUrl`)).value ?? []
    for (const f of files) if (!f.folder) eng2.push({ lib: dr.name, driveId: dr.id, folderId: b.id, batch: b.name, id: f.id, name: f.name, webUrl: f.webUrl })
  }
}
console.log(`ENG2 batch folders: ${eng2.length} files across ${[...new Set(eng2.map(f => f.lib))].join(' | ')}`)
const eng2ByName = new Map(eng2.map(f => [f.name.toLowerCase(), f]))
const NUM = /6105A[A-Z0-9]{2,6}-[A-Z0-9]{3,4}-[A-Z][A-Z0-9]{2,4}-[A-Z0-9]{3,6}/i
const eng2ByNum = new Map(); for (const f of eng2) { const m = NUM.exec(f.name); if (m) (eng2ByNum.get(K(m[0])) ?? eng2ByNum.set(K(m[0]), []).get(K(m[0]))).push(f) }
// whole-ENG2 PDF index for the "search for PDF" rows
const pdfIndex = new Map()
for (const dr of drives) {
  const walk = async (id, depth) => { const kids = (await get(`/drives/${dr.id}/items/${id}/children?$top=999&$select=id,name,folder,webUrl`).catch(() => ({}))).value ?? []; for (const k of kids) { if (k.folder) { if (depth < 4) await walk(k.id, depth + 1) } else if (/\.pdf$/i.test(k.name)) { const m = NUM.exec(k.name); if (m) (pdfIndex.get(K(m[0])) ?? pdfIndex.set(K(m[0]), []).get(K(m[0]))).push({ lib: dr.name, name: k.name, webUrl: k.webUrl }) } } }
  await walk('root', 0)
}
console.log(`ENG2 PDF index: ${pdfIndex.size} numbers`)

// ── 4. the plan ──────────────────────────────────────────────────────────────────────
const P = { appendRows: [], tickRows: [], setStatus: [], fixCell: [], rename: [], copyNew: [], archive: [], pdfFound: [], pdfMissing: [], newRequest: [], regDone: [], regSkip: [], holds: [], questions: [] }
const LIB = { E: 'ELECTRICAL', I: 'INSTRUMENTATION', M: 'MECHANICAL', A: 'AUTOMATION', C: 'CIVIL', S: 'SPECIFICATIONS', G: 'PROJECT CONTROLS & GENERAL', P: 'PROJECT CONTROLS & GENERAL', F: 'ELECTRICAL', B: 'PROJECT CONTROLS & GENERAL' }
const fileOf = (r) => { const n = r.file.split('/').pop(); return eng2ByName.get(S(n).toLowerCase()) ?? null }
for (const r of all) {
  const k = K(r.docno)
  const inC = k ? cddl.get(k) : null
  switch (r.kind) {
    case 'archive': {
      const f = fileOf(r); if (f) P.archive.push({ r, f }); else P.holds.push({ r, why: 'archive: file not in an ENG2 batch folder (nothing to move)' })
      P.regSkip.push(r); break
    }
    case 'cancel': P.regSkip.push(r); break
    case 'keep': case 'as-decided': case 'loe': case 'loe+pdf': case 'pdf': {
      const loe = r.kind.startsWith('loe')
      if (inC) { if (wantsTender(r)) P.tickRows.push({ r, row: inC.row }); if (loe && inC.status !== LOE) P.setStatus.push({ r, row: inC.row, from: inC.status, to: LOE }) }
      else if (paste.has(k)) { const row = { ...paste.get(k) }; if (loe) row['Aconex Status'] = LOE; P.appendRows.push({ r, row }) }
      else if (k) P.holds.push({ r, why: `not on the CDDL and not in the paste sheet (held back: ${r.held || r.numprob || 'unknown'})` })
      else P.holds.push({ r, why: 'no document number — cannot be on the CDDL' })
      if (r.kind === 'pdf' || r.kind === 'loe+pdf') { const hits = pdfIndex.get(k) ?? []; if (hits.length) P.pdfFound.push({ r, hits }); else P.pdfMissing.push(r) }
      P.regDone.push(r); break
    }
    case 'rename-to-register': {
      const f = fileOf(r)
      if (!f) { P.holds.push({ r, why: 'rename: file not in an ENG2 batch folder' }); break }
      const ext = f.name.match(/\.[^.]+$/)?.[0] ?? '.pdf'
      const rev = (f.name.match(/_([A-Z0-9]{1,4})\.[^.]+$/i)?.[1]) ?? 'A'
      const newName = `${r.docno}_${rev}${ext}`
      P.rename.push({ r, f, newName, collide: eng2ByName.has(newName.toLowerCase()) })
      if (inC) { if (wantsTender(r)) P.tickRows.push({ r, row: inC.row }) } else if (paste.has(k)) P.appendRows.push({ r, row: paste.get(k) }); else P.holds.push({ r, why: 'rename: number not on the CDDL and not in the paste sheet' })
      P.regDone.push(r); break
    }
    case 'new-number': case 'fix-both': {
      const nn = NEW_NUMBER[r.ref]; const f = fileOf(r)
      const ext0 = (f?.name ?? r.file).match(/\.[^.]+$/)?.[0] ?? '.pdf'
      const rev0 = ((f?.name ?? r.file).match(/_([A-Z0-9]{1,4})\.[^.]+$/i)?.[1]) ?? 'A'
      const newName = `${nn.docno}_${rev0}${ext0}`
      if (f) P.rename.push({ r, f, newName, collide: eng2ByName.has(newName.toLowerCase()) })
      else P.copyNew.push({ r, newName, src: r.file, lib: LIB[nn.docno.match(/-([A-Z])[A-Z0-9]{3}-/)?.[1]] ?? null })   // held back from the copy (no number in its name) — copy it now under its new name
      const oldRow = inC ?? (k ? cddl.get(k) : null)
      if (r.kind === 'fix-both' && oldRow) {
        // ⚠ the register row that currently carries the OLD number might be a different, real
        // document. Show its title so a person can see it is the same one before it is renumbered.
        if (cddl.has(K(nn.docno))) P.holds.push({ r, why: `fix: ${nn.docno} already exists on the CDDL (row ${cddl.get(K(nn.docno)).row}) — renumbering row ${oldRow.row} would create a duplicate` })
        else P.fixCell.push({ r, row: oldRow.row, col: C.doc, from: r.docno, to: nn.docno, rowTitle: oldRow.title, reviewTitle: r.title })
      }
      else if (cddl.has(K(nn.docno))) { if (wantsTender(r)) P.tickRows.push({ r, row: cddl.get(K(nn.docno)).row }) }
      else P.appendRows.push({ r, row: { 'RDMC Document Number': nn.docno, 'Major Description': nn.title ?? r.title, 'Aconex Status': 'RES - Reserved Placeholder', 'To be Issued for Tender': wantsTender(r), 'Engineering Comments': `B-list review, JB feedback 4 Sep 2026 (${r.ref})` }, synthetic: true })
      P.regDone.push(r); break
    }
    case 'fix-register': {
      const nn = NEW_NUMBER[r.ref]
      if (inC && cddl.has(K(nn.docno))) P.holds.push({ r, why: `fix: ${nn.docno} already exists on the CDDL (row ${cddl.get(K(nn.docno)).row}) — correcting row ${inC.row} would create a duplicate` })
      else if (inC) P.fixCell.push({ r, row: inC.row, col: C.doc, from: r.docno, to: nn.docno, rowTitle: inC.title, reviewTitle: r.title })
      else if (cddl.has(K(nn.docno))) { if (wantsTender(r)) P.tickRows.push({ r, row: cddl.get(K(nn.docno)).row }) }
      else if (paste.has(k)) { const row = { ...paste.get(k) }; row['RDMC Document Number'] = nn.docno; P.appendRows.push({ r, row }) }
      else P.holds.push({ r, why: 'fix register: neither number is on the CDDL or in the paste sheet' })
      P.regDone.push(r); break
    }
    case 'new-request': P.newRequest.push(r); break
    default: P.holds.push({ r, why: `unclassified: "${r.jb}"` })
  }
}
// Morné, 2026-09-05: hold these five for Johan — nothing on them is written, file renames
// included, and their register rows stay pending.
const HOLD_REFS = new Set(['CO-244', 'CO-100', 'CO-326', 'CO-327', 'CO-328'])
for (const key of ['appendRows', 'tickRows', 'setStatus', 'fixCell', 'rename', 'copyNew', 'archive', 'regDone', 'regSkip']) P[key] = P[key].filter(x => !HOLD_REFS.has((x.r ?? x).ref))
for (const ref of HOLD_REFS) if (!P.holds.some(h => h.r.ref === ref)) P.holds.push({ r: all.find(r => r.ref === ref), why: 'held for Johan (Morné, 5 Sep)' })
// a row cannot both be appended and ticked; dedupe append by number
const seen = new Set(); P.appendRows = P.appendRows.filter(a => { const k = K(a.row['RDMC Document Number']); if (seen.has(k)) return false; seen.add(k); return true })

// ── 5. report ────────────────────────────────────────────────────────────────────────
const say = (t) => console.log(t)
say(`\n════ PLAN ════`)
say(`CDDL  append ${P.appendRows.length} new rows (${P.appendRows.filter(a => a.row['Aconex Status'] === LOE).length} at level of effort, ${P.appendRows.filter(a => a.synthetic).length} new numbers)`)
say(`CDDL  tick "To be Issued for Tender" on ${P.tickRows.length} existing rows (${P.tickRows.filter(t => cddl.get(K(t.r.docno))?.tender === true || String(cddl.get(K(t.r.docno))?.tender).toLowerCase() === 'true').length} already ticked)`)
say(`CDDL  set status to "${LOE}" on ${P.setStatus.length} existing rows`); for (const s of P.setStatus) say(`      row ${s.row} ${s.r.docno}: "${s.from}" → level of effort`)
say(`CDDL  correct ${P.fixCell.length} entries`); for (const f of P.fixCell) say(`      row ${f.row}: ${f.from} → ${f.to} (${f.r.ref})\n         register row reads: "${f.rowTitle}"\n         review row reads:   "${f.reviewTitle}"`)
say(`ENG2  rename ${P.rename.length} files`); for (const x of P.rename) say(`      ${x.f.lib}/${x.f.batch}: ${x.f.name} → ${x.newName}${x.collide ? '  ⚠ NAME ALREADY EXISTS' : ''}  (${x.r.ref})`)
say(`ENG2  copy ${P.copyNew.length} held-back files from the OneDrive transfer folder under their new number`); for (const x of P.copyNew) say(`      ${x.src} → ${x.lib ?? '?'}/${BATCHES[0]}/${x.newName}  (${x.r.ref})`)
// register numbers that do not look like RDMC numbers — Johan said "keep register name", so ask, do not fix
for (const x of P.rename) { const seq = x.r.docno.split('-').pop(); if (seq && /^\d{3}$/.test(seq)) P.questions.push(`${x.r.ref}: register number ${x.r.docno} has a 3-digit sequence (RDMC numbers are 4) — keep "-${seq}" as instructed, or should it read -0${seq}?`) }
say(`\nQUESTIONS FOR JOHAN (${P.questions.length})`); for (const q of P.questions) say(`      ${q}`)
say(`ENG2  archive ${P.archive.length} files (move into "Archive" subfolder of the batch folder)`); for (const x of P.archive) say(`      ${x.f.lib}: ${x.f.name}  (${x.r.ref})`)
say(`PDF   ${P.pdfFound.length} native-only rows HAVE a PDF in ENG2`); for (const x of P.pdfFound) say(`      ${x.r.ref} ${x.r.docno} → ${x.hits.map(h => `${h.lib}/${h.name}`).join(' ; ')}`)
say(`PDF   ${P.pdfMissing.length} native-only rows have NO PDF in ENG2 (use the native file)`); for (const r of P.pdfMissing) say(`      ${r.ref} ${r.docno}  ${r.file.split('/').pop()}`)
say(`DC    ${P.newRequest.length} need a document number request`); for (const r of P.newRequest) say(`      ${r.ref} "${r.title.slice(0, 60)}"  ${r.file.split('/').pop()}`)
say(`REG   cddl_carryover: ${P.regDone.length} → done · ${P.regSkip.length} → skipped`)
say(`HOLD  ${P.holds.length} rows nothing can be done to yet`); for (const h of P.holds) say(`      ${h.r.ref} ${h.r.docno || '(no number)'}: ${h.why}`)
fs.writeFileSync(String.raw`C:\Users\mornec\AppData\Local\Temp\claude\k480\blist-mail\plan.json`, JSON.stringify(P, (k, v) => (k === 'row' && typeof v === 'object' ? v : v), 1))

if (!WRITE) { say('\n(dry run — pass --write to apply)'); await wcall('POST', `${WBK}/closeSession`).catch(() => null); process.exit(0) }

// ── 6. write ─────────────────────────────────────────────────────────────────────────
// CDDL: cell corrections, status, tender ticks, then append rows in one block.
for (const f of P.fixCell) await wcall('PATCH', `${WBK}/${SHEET}/range(address='${f.col}${f.row}')`, { values: [[f.to]] })
for (const s of P.setStatus) await wcall('PATCH', `${WBK}/${SHEET}/range(address='${C.status}${s.row}')`, { values: [[s.to]] })
for (const t of P.tickRows) await wcall('PATCH', `${WBK}/${SHEET}/range(address='${C.tender}${t.row}')`, { values: [[true]] })
if (P.appendRows.length) {
  const width = head.length
  const values = P.appendRows.map(a => head.map(h => {
    if (h === 'Originator') return 'PPE Technologies'
    if (h === 'EPCM ruling') return 'NOT REVIEWED'
    if (h === 'EPCM reason') return `Added from the K038 carry-over (B list) on Johan Botes' feedback of 4 Sep 2026 (${a.r.ref}).`
    const v = a.row[h]; if (h === 'To be Issued for Tender' || h === 'Added to Balance of plant folders' || h === 'Detailed Design') return v === true || String(v).toLowerCase() === 'true'; return v ?? ''
  }))
  const start = last + 1, end = last + values.length
  await wcall('PATCH', `${WBK}/${SHEET}/range(address='A${start}:${String.fromCharCode(64 + width)}${end}')`, { values })
  say(`appended rows ${start}-${end}`)
}
await wcall('POST', `${WBK}/closeSession`).catch(() => null)
// ENG2: renames and archive moves
for (const x of P.rename) { if (x.collide) { say(`skip rename (collision): ${x.newName}`); continue } await gcall('PATCH', `/drives/${x.f.driveId}/items/${x.f.id}`, { name: x.newName }) }
// held-back files: copy from the OneDrive transfer folder into the batch folder under the new name
const OWNER = 'mornec@ppetech.co.za', ROOT = 'Company Docs/Jarrod add to CDDL K124'
const enc = (p) => p.split('/').map(encodeURIComponent).join('/')
for (const x of P.copyNew) {
  const dr = drives.find(d => d.name.toUpperCase() === (x.lib ?? '').toUpperCase()); if (!dr) { say(`skip copy: no ENG2 library for ${x.newName}`); continue }
  const kids = (await get(`/drives/${dr.id}/root/children?$top=999&$select=id,name,folder`)).value ?? []
  let dest = kids.find(k => k.folder && k.name === BATCHES[0]); if (!dest) dest = await gcall('POST', `/drives/${dr.id}/root/children`, { name: BATCHES[0], folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
  const src = await get(`/users/${OWNER}/drive/root:/${enc(`${ROOT}/${x.src}`)}`).catch(() => null)
  if (!src?.id) { say(`skip copy: source missing ${x.src}`); continue }
  const res = await retry(async () => fetch(`${G}/drives/${src.parentReference.driveId}/items/${src.id}/copy`, { method: 'POST', headers: H, body: JSON.stringify({ parentReference: { driveId: dr.id, id: dest.id }, name: x.newName }) }))
  say(`copy ${res.status === 202 ? 'requested' : 'FAILED ' + res.status}: ${x.newName}`)
}
const arch = new Map()
for (const x of P.archive) {
  const key = `${x.f.driveId}/${x.f.folderId}`
  if (!arch.has(key)) { const kids = (await get(`/drives/${x.f.driveId}/items/${x.f.folderId}/children?$select=id,name,folder&$top=999`)).value ?? []; let a = kids.find(k => k.folder && k.name === 'Archive'); if (!a) a = await gcall('POST', `/drives/${x.f.driveId}/items/${x.f.folderId}/children`, { name: 'Archive', folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }); arch.set(key, a.id) }
  await gcall('PATCH', `/drives/${x.f.driveId}/items/${x.f.id}`, { parentReference: { id: arch.get(key) } })
}
// REG: status per row
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const now = new Date().toISOString()
for (const r of P.regDone) await sb.from('cddl_carryover').update({ status: 'done', decided_by: 'Johan Botes (JB feedback 4 Sep 2026)', decided_at: now }).eq('temp_ref', r.ref)
for (const r of P.regSkip) await sb.from('cddl_carryover').update({ status: 'skipped', decided_by: 'Johan Botes (JB feedback 4 Sep 2026)', decided_at: now }).eq('temp_ref', r.ref)
// ── 7. verify by reading back ────────────────────────────────────────────────────────
const sess2 = await gcall('POST', `${WBK}/createSession`, { persistChanges: false })
const HS2 = { ...H, 'workbook-session-id': sess2.id }
const rcall = async (u) => retry(async () => { const r = await fetch(G + u, { headers: HS2 }); if (!r.ok) throw new Error(`${r.status}`); return r.json() })
const last2 = (await rcall(`${WBK}/${SHEET}/usedRange(valuesOnly=true)?$select=rowCount`)).rowCount
const [d2, s2, t2] = await Promise.all([C.doc, C.status, C.tender].map(async (L) => (await rcall(`${WBK}/${SHEET}/range(address='${L}1:${L}${last2}')?$select=values`)).values.map(v => v[0])))
const byNo = new Map(); for (let i = 1; i < last2; i++) if (K(d2[i])) byNo.set(K(d2[i]), { status: S(s2[i]), tender: t2[i] })
const okStatus = P.setStatus.filter(s => byNo.get(K(s.r.docno))?.status === LOE).length
const okAppend = P.appendRows.filter(a => byNo.has(K(a.row['RDMC Document Number']))).length
const okTick = P.tickRows.filter(t => { const v = byNo.get(K(t.r.docno))?.tender; return v === true || String(v).toLowerCase() === 'true' }).length
await fetch(`${G}${WBK}/closeSession`, { method: 'POST', headers: HS2 }).catch(() => null)
let okRename = 0
for (const x of P.rename) { if (x.collide) continue; const it = await get(`/drives/${x.f.driveId}/items/${x.f.id}?$select=name`).catch(() => null); if (it?.name === x.newName) okRename++ }
say(`\nVERIFIED  CDDL rows now ${last2} · status set ${okStatus}/${P.setStatus.length} · appended found ${okAppend}/${P.appendRows.length} · ticked ${okTick}/${P.tickRows.length} · renamed ${okRename}/${P.rename.filter(x => !x.collide).length}`)
say('WRITTEN.')
