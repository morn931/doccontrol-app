// Set up the prelim sessions for the K480 tender push from Johan's list.
//
// Johan's list = the VISIBLE rows of the "Construct Doc Register" sheet in the workbook he
// attached (filtered: To be Issued for Tender = True, status RES / No Placeholder) — 201
// documents across four substations. This script:
//   1. reads those rows (openpyxl already exported them to johan-list.json)
//   2. walks the COLAB Document Register folder on the K138 site and matches files to the
//      list by RDMC or PPE number in the filename
//   3. creates ONE prelim_session per substation folder (skipping any that already exists)
//   4. pulls each matched file the way /api/prelim/sessions/[id]/pull does: working PDF copy
//      into Internal Reviews/Prelim/<session>/, prelim_document row with its CDDL match
// Files on the list that are not in COLAB yet are reported, not invented.
//
//   node scripts/prelim-setup-colab.mjs           dry run — match and report
//   node scripts/prelim-setup-colab.mjs --write   create sessions and pull
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('='); const k = t.slice(0, i).trim()
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const WRITE = process.argv.includes('--write')
const S = (v) => String(v ?? '').trim()
const K = (v) => S(v).toUpperCase().replace(/[\s_]/g, '')
const retry = async (fn, n = 5) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))) } } }
const tok = (await retry(async () => (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
})).json())).access_token
const H = { Authorization: `Bearer ${tok}` }
const G = 'https://graph.microsoft.com/v1.0'
const gget = async (u) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 80)} ${(await r.text()).slice(0, 160)}`); return r.json() })
const siteId = async (url) => { const u = new URL(url); return (await gget(`/sites/${u.hostname}:${u.pathname}`)).id }
const driveId = async (sid, name) => { const ds = (await gget(`/sites/${sid}/drives?$select=id,name`)).value ?? []; const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''); const d = ds.find(x => x.name === name) ?? ds.find(x => norm(x.name) === norm(name)); if (!d) throw new Error(`library "${name}" not in ${ds.map(x => x.name).join(', ')}`); return d.id }

const SOURCE_SITE = process.env.PRELIM_SOURCE_SITE_URL || 'https://ppetechcoza.sharepoint.com/sites/K138-BalanceofPlant'
const SOURCE_LIB  = process.env.PRELIM_SOURCE_LIBRARY || 'COLAB'
const DC_SITE     = process.env.INTERNAL_REVIEW_SITE_URL || process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL
const IR_LIB      = process.env.INTERNAL_REVIEW_LIBRARY || 'Internal Reviews'
const PRELIM_FOLDER = process.env.PRELIM_FOLDER || 'Prelim'
const BY = 'mornec@ppetech.co.za'

// ── 1. the list ────────────────────────────────────────────────────────────────────────
const LIST = String.raw`C:\Users\mornec\AppData\Local\Temp\claude\k480\johan-list\johan-list.json`
const list = JSON.parse(fs.readFileSync(LIST, 'utf8'))
console.log(`Johan's list: ${list.length} documents`)

// substation folder per Plant value on the list
const FOLDER_BY_PLANT = [
  [/plant main substation/i, 'Main Consumer Substation'],
  [/power station substation/i, 'Main Intake Substation'],
  [/mining substation/i, 'Mining Substation'],
  [/pv plant substation/i, 'Solar PV Substation'],
]
const folderOf = (plant) => (FOLDER_BY_PLANT.find(([re]) => re.test(plant)) ?? [null, null])[1]

// ── 2. what is in COLAB ────────────────────────────────────────────────────────────────
const srcSite = await siteId(SOURCE_SITE), srcDrive = await driveId(srcSite, SOURCE_LIB)
const root = (await gget(`/drives/${srcDrive}/root/children?$select=id,name,folder&$top=999`)).value ?? []
const plantWide = root.find(x => x.folder && /plant wide/i.test(x.name))
if (!plantWide) throw new Error('PLANT WIDE folder not found in COLAB root: ' + root.map(x => x.name).join(', '))
const pw = (await gget(`/drives/${srcDrive}/items/${plantWide.id}/children?$select=id,name,folder&$top=999`)).value ?? []
const reg = pw.find(x => x.folder && /document register/i.test(x.name))
if (!reg) throw new Error('Document Register folder not found under ' + plantWide.name)
const REG_PATH = `${plantWide.name}/${reg.name}`
const files = []
const walk = async (itemId, prefix, depth = 0) => {
  const r = (await gget(`/drives/${srcDrive}/items/${itemId}/children?$select=id,name,folder,size,webUrl,lastModifiedDateTime&$top=999`)).value ?? []
  for (const c of r) { const p = `${prefix}/${c.name}`; if (c.folder) { if (depth < 5) await walk(c.id, p, depth + 1) } else files.push({ id: c.id, name: c.name, path: p, top: prefix.split('/')[0], size: c.size, webUrl: c.webUrl, modified: c.lastModifiedDateTime }) }
}
for (const sub of (await gget(`/drives/${srcDrive}/items/${reg.id}/children?$select=id,name,folder&$top=999`)).value ?? []) if (sub.folder) await walk(sub.id, sub.name)
console.log(`COLAB ${REG_PATH}: ${files.length} files across ${[...new Set(files.map(f => f.top))].length} folders`)

// match on RDMC number, then PPE number, anywhere in the file name
const byRdmc = new Map(list.map(d => [K(d.rdmc), d])), byPpe = new Map(list.filter(d => d.ppe).map(d => [K(d.ppe), d]))
const NUM = /6105A[A-Z0-9]{2,5}-[A-Z0-9]{4}-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}|Q-?2405\d{4}-\d{2}-\d{4}-[A-Z]-[A-Z0-9]{2,4}-\d{3,5}/gi
const matched = new Map()   // rdmc key -> file
const unmatchedFiles = []
for (const f of files) {
  const nums = (f.name.match(NUM) ?? []).map(K)
  const hit = nums.map(n => byRdmc.get(n) ?? byPpe.get(n)).find(Boolean)
  if (!hit) { unmatchedFiles.push(f); continue }
  const k = K(hit.rdmc)
  const prev = matched.get(k)
  if (!prev || new Date(f.modified) > new Date(prev.modified)) matched.set(k, { ...f, doc: hit })
}
const missing = list.filter(d => !matched.has(K(d.rdmc)))
console.log(`\nMATCHED ${matched.size} of ${list.length} · NOT IN COLAB YET ${missing.length} · COLAB files not on the list ${unmatchedFiles.length}`)
const tally = (xs, f) => Object.entries(xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])
console.log('matched by folder:', tally([...matched.values()], f => f.top).map(([k, v]) => `${k} ${v}`).join(' · '))
console.log('missing by plant :', tally(missing, d => folderOf(d.plant) ?? d.plant).map(([k, v]) => `${k} ${v}`).join(' · '))
const cross = [...matched.values()].filter(f => folderOf(f.doc.plant) && !f.path.startsWith(folderOf(f.doc.plant)))
if (cross.length) { console.log(`⚠ ${cross.length} matched files sit in a different substation folder from the list's plant:`); for (const f of cross.slice(0, 10)) console.log(`   ${f.doc.rdmc}  list=${folderOf(f.doc.plant)}  file=${f.path}`) }
console.log('\nCOLAB files not on the list (first 15):'); for (const f of unmatchedFiles.slice(0, 15)) console.log(`   ${f.path}`)
fs.writeFileSync(LIST.replace('johan-list.json', 'colab-match.json'), JSON.stringify({ matched: [...matched.values()], missing, unmatchedFiles }, null, 1))
if (!WRITE) { console.log('\n(dry run — pass --write to create the sessions and pull)'); process.exit(0) }

// ── 3 + 4. sessions and pulls ──────────────────────────────────────────────────────────
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const dcSite = await siteId(DC_SITE), irDrive = await driveId(dcSite, IR_LIB)
const enc = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')
const sessionFolder = (title, id) => `${PRELIM_FOLDER}/${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)} ${id.slice(0, 8)}`

for (const [, folder] of FOLDER_BY_PLANT) {
  const docs = [...matched.values()].filter(f => folderOf(f.doc.plant) === folder)
  const title = `${folder} — tender drawings (Colab list, Sep 2026)`
  const srcFolder = `${REG_PATH}/${folder}`
  let { data: sess } = await sb.from('prelim_session').select('id, title').eq('source_folder', srcFolder).eq('status', 'open').maybeSingle()
  if (!sess) {
    const { data, error } = await sb.from('prelim_session').insert({
      title, area: folder, source_site_url: SOURCE_SITE, source_library: SOURCE_LIB, source_folder: srcFolder,
      attendees: null, notes: `Set up from Johan Botes' Colab list (email 3 Sep 2026): ${list.filter(d => folderOf(d.plant) === folder).length} documents on the list for this substation.`,
      created_by_email: BY, created_by_name: 'Morné Cronjé',
    }).select('id, title').single()
    if (error) throw error
    sess = data; console.log(`\nopened session "${title}" ${sess.id}`)
  } else console.log(`\nsession exists "${sess.title}" ${sess.id}`)
  const fold = sessionFolder(sess.title, sess.id)
  let pulled = 0, skipped = 0, failed = 0
  for (const f of docs) {
    const { data: exists } = await sb.from('prelim_document').select('id').eq('session_id', sess.id).eq('source_file_url', f.webUrl).maybeSingle()
    if (exists) { skipped++; continue }
    try {
      const isPdf = /\.pdf$/i.test(f.name)
      const bytesRes = await retry(async () => { const r = await fetch(`${G}/drives/${srcDrive}/items/${f.id}/content${isPdf ? '' : '?format=pdf'}`, { headers: H }); if (!r.ok) throw new Error(`content ${r.status}`); return r })
      const bytes = await bytesRes.arrayBuffer()
      const workingName = isPdf ? f.name : f.name.replace(/\.[^.]+$/, '') + '.pdf'
      const up = await retry(async () => { const r = await fetch(`${G}/sites/${dcSite}/drives/${irDrive}/root:/${enc(`${fold}/${workingName}`)}:/content`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/pdf' }, body: bytes }); if (!r.ok) throw new Error(`upload ${r.status} ${(await r.text()).slice(0, 120)}`); return r.json() })
      const { data: cddl } = await sb.from('cddl_doc').select('id, docno, title, discipline, doc_type, revision').ilike('docno', f.doc.rdmc).limit(1).maybeSingle()
      const revMatch = f.name.match(/_([A-Z0-9]{1,4})\.pdf$/i)
      const { error } = await sb.from('prelim_document').insert({
        session_id: sess.id, cddl_doc_id: cddl?.id ?? null, document_number: f.doc.rdmc,
        revision: revMatch?.[1] ?? cddl?.revision ?? null,
        title: cddl?.title ?? `${f.doc.desc} — ${f.doc.broad}`.trim(), discipline: cddl?.discipline ?? f.doc.disc ?? null, document_type: cddl?.doc_type ?? f.doc.type ?? null,
        source_file_name: f.name, source_file_url: f.webUrl, working_file_name: workingName, working_file_url: up.webUrl, pulled_by_email: BY,
      })
      if (error) throw error
      pulled++
    } catch (e) { failed++; console.log(`   ✗ ${f.doc.rdmc} ${f.name}: ${e.message}`) }
  }
  console.log(`   pulled ${pulled} · already there ${skipped} · failed ${failed} · on the list for this substation: ${list.filter(d => folderOf(d.plant) === folder).length}`)
}
console.log('\ndone')
