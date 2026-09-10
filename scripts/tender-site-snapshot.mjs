// Snapshot / compare / restore the K480 SWP-006 tender pack site (Morné, 10 Sep: Marnus is
// about to move files between folders by hand; keep a record so we can prove nothing was lost
// or duplicated, and put things back if we must).
//
//   node scripts/tender-site-snapshot.mjs --label=before-marnus          take a snapshot
//   node scripts/tender-site-snapshot.mjs --compare=<snapshot.json>      diff live site vs snapshot
//   node scripts/tender-site-snapshot.mjs --restore=<snapshot.json> [--write]
//                                          move/rename every surviving item back to where it was
//
// A snapshot records every folder and file by SharePoint item id: path, parent id, size,
// content hash (quickXorHash), modified time. Item ids survive a move or rename, so the compare
// can tell "moved" from "deleted + re-uploaded", and the restore moves items by id — it never
// re-uploads bytes. Snapshots go to %TEMP%/claude/k480/snapshots/ and a copy of the listing to
// the Desktop as xlsx.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const args = process.argv.slice(2)
const opt = (k) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const WRITE = args.includes('--write')
const SITE = '/sites/K480SWP-006TenderPack', ROOT = 'K480 SWP-006 Power and Balance of Plant'
const DIR = 'C:/Users/mornec/AppData/Local/Temp/claude/k480/snapshots/'; fs.mkdirSync(DIR, { recursive: true })
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? '').toUpperCase()

const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const retry = async (fn, n = 4) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n || /^4(0[0-9]|1[0-9])\b/.test(String(e.message))) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))) } } }
const g = (u) => retry(async () => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} GET ${u.slice(0, 120)}`); return r.json() })
const enc = (p) => p.split('/').map(encodeURIComponent).join('/')
const site = await g(`/sites/ppetechcoza.sharepoint.com:${SITE}`)
const drive = (await g(`/sites/${site.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents').id

async function live() {
  const rootItem = await g(`/drives/${drive}/root:/${enc(ROOT)}?$select=id,name`)
  const items = [] // {id, name, path, parentId, folder, size, hash, modified, by, webUrl}
  async function walk(id, path) {
    let u = `/drives/${drive}/items/${id}/children?$select=id,name,folder,file,size,lastModifiedDateTime,lastModifiedBy,webUrl,parentReference&$top=999`
    while (u) {
      const j = await g(u)
      for (const k of j.value ?? []) {
        const p = `${path}/${k.name}`
        items.push({ id: k.id, name: k.name, path: p, parentId: k.parentReference?.id, folder: !!k.folder, size: k.size ?? 0, hash: k.file?.hashes?.quickXorHash ?? null, modified: k.lastModifiedDateTime, by: k.lastModifiedBy?.user?.displayName ?? '', webUrl: k.webUrl })
        if (k.folder) await walk(k.id, p)
      }
      u = j['@odata.nextLink']
    }
  }
  await walk(rootItem.id, ROOT)
  return { takenAt: new Date().toISOString(), site: SITE, drive, root: { id: rootItem.id, path: ROOT }, items }
}

function summarise(snap) {
  const files = snap.items.filter(i => !i.folder), folders = snap.items.filter(i => i.folder)
  const bySection = {}
  for (const f of files) { const s = f.path.split('/')[1]; bySection[s] = (bySection[s] ?? 0) + 1 }
  return { files: files.length, folders: folders.length, mb: (files.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(0), bySection }
}
function dupes(snap) {
  const out = []
  const byStem = new Map(), byHash = new Map()
  for (const f of snap.items.filter(i => !i.folder)) {
    const s = stemOf(f.name); if (s) { if (!byStem.has(s)) byStem.set(s, []); byStem.get(s).push(f) }
    if (f.hash) { if (!byHash.has(f.hash)) byHash.set(f.hash, []); byHash.get(f.hash).push(f) }
  }
  for (const [s, fs_] of byStem) if (fs_.length > 1) out.push({ kind: 'same document number', key: s, files: fs_.map(f => f.path) })
  for (const [h, fs_] of byHash) if (fs_.length > 1) out.push({ kind: 'identical bytes', key: h, files: fs_.map(f => f.path) })
  return out
}

const restoreArg = opt('restore'), compareArg = opt('compare')
if (compareArg) {
  const old = JSON.parse(fs.readFileSync(compareArg, 'utf8')), now = await live()
  const oldById = new Map(old.items.map(i => [i.id, i])), nowById = new Map(now.items.map(i => [i.id, i]))
  const moved = [], renamed = [], changed = [], deleted = [], added = []
  for (const o of old.items) {
    const n = nowById.get(o.id)
    if (!n) { deleted.push(o); continue }
    if (n.parentId !== o.parentId) moved.push({ from: o.path, to: n.path })
    else if (n.name !== o.name) renamed.push({ from: o.path, to: n.path })
    if (!o.folder && o.hash && n.hash && o.hash !== n.hash) changed.push({ path: n.path, was: o.modified, now: n.modified, by: n.by })
  }
  for (const n of now.items) if (!oldById.has(n.id)) added.push(n)
  // a "deleted" file whose bytes reappear under a new id = re-uploaded copy, not a loss
  const nowHashes = new Map(); for (const n of now.items) if (n.hash) nowHashes.set(n.hash, n)
  const lost = deleted.filter(d => !d.folder && !(d.hash && nowHashes.has(d.hash)))
  const reuploaded = deleted.filter(d => !d.folder && d.hash && nowHashes.has(d.hash)).map(d => ({ was: d.path, nowAs: nowHashes.get(d.hash).path }))
  const S = summarise(old), N = summarise(now)
  console.log(`snapshot ${old.takenAt.slice(0, 16)}: ${S.files} files / ${S.folders} folders / ${S.mb} MB`)
  console.log(`live     ${now.takenAt.slice(0, 16)}: ${N.files} files / ${N.folders} folders / ${N.mb} MB\n`)
  const show = (t, xs, f) => { console.log(`${t}: ${xs.length}`); for (const x of xs) console.log('   ' + f(x)) }
  show('MOVED (same item, new folder)', moved, x => `${x.from}\n      → ${x.to}`)
  show('RENAMED', renamed, x => `${x.from}\n      → ${x.to}`)
  show('CONTENT CHANGED (same item, new bytes)', changed, x => `${x.path}  (${x.was.slice(0, 16)} → ${x.now.slice(0, 16)} by ${x.by})`)
  show('DELETED FOLDERS', deleted.filter(d => d.folder), x => x.path)
  show('RE-UPLOADED (old item gone, same bytes elsewhere)', reuploaded, x => `${x.was}\n      now ${x.nowAs}`)
  show('⚠ LOST FILES (gone, bytes found nowhere)', lost, x => x.path)
  show('ADDED (new items not in the snapshot)', added.filter(a => !a.folder && !reuploaded.some(r => r.nowAs === a.path)), x => x.path)
  show('ADDED FOLDERS', added.filter(a => a.folder), x => x.path)
  const dNow = dupes(now), dOld = dupes(old)
  const oldKeys = new Set(dOld.map(d => d.kind + d.key))
  show('⚠ DUPLICATES NOW (not present in the snapshot)', dNow.filter(d => !oldKeys.has(d.kind + d.key)), x => `${x.kind} ${x.key}\n      ${x.files.join('\n      ')}`)
  console.log(`(duplicates that already existed in the snapshot: ${dOld.length})`)
  const out = `${DIR}compare-${now.takenAt.replace(/[:.]/g, '-')}.json`
  fs.writeFileSync(out, JSON.stringify({ against: compareArg, moved, renamed, changed, deleted, lost, reuploaded, added, duplicatesNow: dNow }, null, 1)); console.log(`\nwritten ${out}`)
} else if (restoreArg) {
  const old = JSON.parse(fs.readFileSync(restoreArg, 'utf8')), now = await live()
  const nowById = new Map(now.items.map(i => [i.id, i]))
  // folders first (shallowest first) so a moved file's original parent exists again; a
  // deleted folder is re-created by path
  const plan = []
  for (const o of [...old.items].sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
    const n = nowById.get(o.id)
    if (!n) { if (o.folder) plan.push({ act: 'mkdir', path: o.path }); else plan.push({ act: 'MISSING', path: o.path }); continue }
    if (n.parentId !== o.parentId || n.name !== o.name) plan.push({ act: 'move', id: o.id, from: n.path, to: o.path, parentPath: o.path.slice(0, o.path.lastIndexOf('/')), name: o.name })
  }
  console.log(`restore plan: ${plan.filter(p => p.act === 'move').length} moves, ${plan.filter(p => p.act === 'mkdir').length} folders to re-create, ${plan.filter(p => p.act === 'MISSING').length} files that no longer exist (cannot be restored by move)`)
  const folderIds = new Map(now.items.filter(i => i.folder).map(i => [i.path, i.id])); folderIds.set(ROOT, now.root.id)
  for (const p of plan) {
    if (p.act === 'MISSING') { console.log(`   MISSING  ${p.path}`); continue }
    if (!WRITE) { console.log(`   would ${p.act}  ${p.from ?? ''}${p.from ? ' → ' : ''}${p.to ?? p.path}`); continue }
    if (p.act === 'mkdir') {
      const parent = folderIds.get(p.path.slice(0, p.path.lastIndexOf('/')))
      const r = await fetch(`${G}/drives/${drive}/items/${parent}/children`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p.path.slice(p.path.lastIndexOf('/') + 1), folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) })
      const j = await r.json(); if (r.ok) folderIds.set(p.path, j.id); console.log(`   mkdir ${r.status}  ${p.path}`); continue
    }
    const parent = folderIds.get(p.parentPath); if (!parent) { console.log(`   ??  no folder ${p.parentPath} for ${p.to}`); continue }
    const r = await fetch(`${G}/drives/${drive}/items/${p.id}`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ parentReference: { id: parent }, name: p.name, '@microsoft.graph.conflictBehavior': 'fail' }) })
    console.log(`   move ${r.status}  ${p.from} → ${p.to}`)
  }
  if (!WRITE) console.log('(dry run — add --write)')
} else {
  const snap = await live()
  const label = opt('label') ?? 'snapshot'
  const out = `${DIR}${snap.takenAt.slice(0, 19).replace(/[:]/g, '-')}-${label}.json`
  fs.writeFileSync(out, JSON.stringify(snap, null, 1))
  const S = summarise(snap)
  console.log(`snapshot written: ${out}\n${S.files} files · ${S.folders} folders · ${S.mb} MB`)
  for (const [k, v] of Object.entries(S.bySection)) console.log(`   ${String(v).padStart(4)}  ${k}`)
  const d = dupes(snap); console.log(`\nduplicates already present: ${d.length}`); for (const x of d) console.log(`   ${x.kind} ${x.key}\n      ${x.files.join('\n      ')}`)
  // Desktop listing
  const py = `${DIR}_xlsx.py`
  fs.writeFileSync(py, `import json,datetime\nfrom openpyxl import Workbook\nfrom openpyxl.styles import Font,PatternFill\nfrom openpyxl.utils import get_column_letter\ns=json.load(open(r'${out}',encoding='utf-8'))\nwb=Workbook();ws=wb.active;ws.title='Snapshot'\nws.append(['#','Section','Path','File name','Folder?','Size KB','Modified (UTC)','Modified by','Content hash','SharePoint item id'])\nfor c in ws[1]: c.font=Font(bold=True,color='FFFFFF'); c.fill=PatternFill('solid',fgColor='1B3464')\nfor i,it in enumerate(sorted(s['items'],key=lambda i:i['path']),1):\n    p=it['path'].split('/'); ws.append([i,p[1] if len(p)>1 else '', '/'.join(p[1:-1]), it['name'], 'folder' if it['folder'] else '', round(it['size']/1024,1), it['modified'], it['by'], it['hash'] or '', it['id']])\nfor i,w in enumerate([5,44,70,60,8,9,20,18,30,40],1): ws.column_dimensions[get_column_letter(i)].width=w\nws.freeze_panes='A2'; ws.auto_filter.ref=ws.dimensions\nname=r'C:/Users/mornec/Desktop/K480 SWP-006 - Tender pack snapshot ${snap.takenAt.slice(0, 16).replace(/[T:]/g, '-')} ${label}.xlsx'\nwb.save(name); print('desktop copy:',name)\n`)
  const { execSync } = await import('node:child_process'); console.log(execSync(`python "${py}"`).toString().trim())
}
