// Refresh corereports/src/data/swp006-pack-titles.json — title, revision and originator, read off
// the cover page, for every numbered PDF in the tender pack that the engineering CDDL does not
// carry (Morné, 10 Sep: "this is a tender register, so they can appear in there even if they are
// not in the CDDL"). The EDL export lists a pack document with no CDDL row from this file.
//   node scripts/tender-site-pack-titles.mjs            report what is missing from the file
//   node scripts/tender-site-pack-titles.mjs --write    read the missing covers and update the file
// Commit + push corereports afterwards so the live export sees it.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const WRITE = process.argv.includes('--write')
const JSON_PATH = 'C:/Users/mornec/Claude/Projects/Coreflow/corereports-app/src/data/swp006-pack-titles.json'
const T = 'C:/Users/mornec/AppData/Local/Temp/claude/k480/pack-titles/'; fs.mkdirSync(T, { recursive: true })
const stemOf = (s) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? '').toUpperCase()
const titles = fs.existsSync(JSON_PATH) ? JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) : {}

const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const g = async u => { const r = await fetch(u.startsWith('http') ? u : G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 100)}`); return r.json() }
const enc = p => p.split('/').map(encodeURIComponent).join('/')
const site = await g('/sites/ppetechcoza.sharepoint.com:/sites/K480SWP-006TenderPack'); const pd = (await g(`/sites/${site.id}/drives?$select=id,name`)).value.find(x => x.name === 'Documents').id
const files = []
async function walk(p) { let u = `/drives/${pd}/root:/${enc(p)}:/children?$select=id,name,folder&$top=999`; while (u) { const j = await g(u); for (const k of j.value ?? []) { if (k.folder) await walk(`${p}/${k.name}`); else files.push({ id: k.id, name: k.name, path: `${p}/${k.name}` }) } u = j['@odata.nextLink'] } }
await walk('K480 SWP-006 Power and Balance of Plant')
// which pack documents does the CDDL not carry? Read the live CDDL workbook (column E, RDMC
// Document Number) — the export no longer prints a status column to tell them apart (10 Sep).
const CDDL_LINK = 'https://ppetechcoza.sharepoint.com/:x:/s/K138-BalanceofPlant/IQDpZ48of4QlTJ4rjD8WmQlPAbm_PpNSnr7gcLcC9ogWbBo?e=xQKwIc'
const cddlShare = 'u!' + Buffer.from(CDDL_LINK, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
fs.writeFileSync(T + 'cddl.xlsx', Buffer.from(await (await fetch(`${G}/shares/${cddlShare}/driveItem/content`, { headers: H })).arrayBuffer()))
const edlNos = new Set(execFileSync('python', ['-c', `import openpyxl,warnings;warnings.filterwarnings('ignore');ws=openpyxl.load_workbook(r'${T}cddl.xlsx',read_only=True)['Construct Doc Register']\nfor r in ws.iter_rows(min_row=2,values_only=True):\n  v=r[4] if len(r)>4 else None\n  if v and str(v).strip().upper().startswith('6105A'): print(str(v).strip().upper())`]).toString().split(/\r?\n/).filter(Boolean))
const packOnly = new Map()
for (const f of files) { const s = stemOf(f.name); if (s && /\.pdf$/i.test(f.name) && !edlNos.has(s) && !f.path.includes('/90 Reference')) packOnly.set(s, f) }
const missing = [...packOnly.keys()].filter(s => !titles[s])
console.log(`pack documents the register rows do not cover: ${packOnly.size} · already in the titles file: ${packOnly.size - missing.length} · missing: ${missing.length}`)
for (const s of missing) console.log('   ' + s + '  ←  ' + packOnly.get(s).name)
if (!WRITE || !missing.length) { if (!WRITE && missing.length) console.log('add --write to read their cover pages'); process.exit(0) }
for (const s of missing) {
  const f = packOnly.get(s)
  fs.writeFileSync(T + f.name, Buffer.from(await (await fetch(`${G}/drives/${pd}/items/${f.id}/content`, { headers: H })).arrayBuffer()))
  const out = execFileSync('python', ['-c', `import fitz,re,json,sys\nd=fitz.open(sys.argv[1]);L=[l.strip() for l in d[0].get_text().split('\\n') if l.strip()]\nt=r=''\nif 'Document Title:' in L:\n i=L.index('Document Title:');j=i+1;b=[]\n while j<len(L) and not re.match(r'(?i)supplier\\s*/?\\s*contractor details',L[j]) and len(b)<4: b.append(L[j]);j+=1\n t=re.sub(r'\\s+',' ',' '.join(b))\nif 'Rev:' in L:\n k=L.index('Rev:');r=L[k+1] if k+1<len(L) and len(L[k+1])<=3 else ''\nprint(json.dumps({'title':t,'rev':r,'pages':len(d)}))`, T + f.name]).toString()
  const cov = JSON.parse(out)
  const pkg = s.match(/^6105A([A-Z0-9]+)-/)[1]
  titles[s] = { title: cov.title || '(title to be captured)', rev: cov.rev || (f.name.match(/-\d{4}_([A-Z0-9]{1,2})(?=[ .-])/i)?.[1] ?? ''), pages: cov.pages, source: cov.title ? 'cover page' : 'not found on cover', originator: pkg.startsWith('K132') ? 'Fluor - K132 Phase 1 Process Plant EPCM (adopted standard)' : pkg === '0000' ? 'RDMC' : /^E\d/.test(pkg) ? pkg : 'PPE' }
  console.log(`   ${s}  [${titles[s].rev}]  ${titles[s].title.slice(0, 80)}`)
}
fs.writeFileSync(JSON_PATH, JSON.stringify(Object.fromEntries(Object.entries(titles).sort()), null, 1))
console.log(`\nwritten ${JSON_PATH} (${Object.keys(titles).length} documents) — commit and push corereports`)
