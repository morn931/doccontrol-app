// Read the engineers' triage folders and check them against the "A" list (Jarrod's Excel,
// source = 'k038 highlighted', 199 rows).
//
// The question is whether they covered the WHOLE list or only the electrical part, so the
// comparison has to be per DISCIPLINE, and it has to be driven by the register rather than
// by what the folders happen to contain — a folder can only tell you what IS there, never
// what is missing.
import fs from 'node:fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('='); const k = t.slice(0, i).trim()
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const LINK = process.argv[2]
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const tr = await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST',
  body: new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  }),
})
const tok = (await tr.json()).access_token
if (!tok) { console.log('no token'); process.exit(1) }
const H = { Authorization: `Bearer ${tok}` }

const root = await (await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId(LINK)}/driveItem`, { headers: H, cache: 'no-store' })).json()
if (!root.id) { console.log(JSON.stringify(root).slice(0, 400)); process.exit(1) }
console.log(`ROOT: ${root.name}   (${root.folder?.childCount ?? '?'} children)\n`)
const driveId = root.parentReference.driveId

async function walk(itemId, prefix = '', depth = 0) {
  const out = []
  let url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=999&$select=id,name,folder,file,size`
  while (url) {
    const r = await (await fetch(url, { headers: H, cache: 'no-store' })).json()
    for (const c of r.value ?? []) {
      const path = prefix ? `${prefix}/${c.name}` : c.name
      if (c.folder) {
        if (depth < 6) out.push(...await walk(c.id, path, depth + 1))
      } else out.push({ path, name: c.name, size: c.size })
    }
    url = r['@odata.nextLink']
  }
  return out
}

// Top level = the three decision folders.
const top = await (await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${root.id}/children?$top=999&$select=id,name,folder`, { headers: H })).json()
const buckets = []
for (const c of top.value ?? []) {
  if (!c.folder) continue
  const files = await walk(c.id, '')
  buckets.push({ name: c.name, files })
  console.log(`  ${String(files.length).padStart(4)} files   ${c.name}`)
}
const loose = (top.value ?? []).filter((c) => !c.folder)
if (loose.length) console.log(`  ${String(loose.length).padStart(4)} files   (loose at the root)`)

// ── The A list ────────────────────────────────────────────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const A = []
for (let off = 0; ; off += 1000) {
  const r = await fetch(`${URL}/rest/v1/cddl_carryover?select=temp_ref,legacy_docno,ai_docno,docno,discipline,major_desc,doc_class&source=eq.k038%20highlighted&order=temp_ref&offset=${off}&limit=1000`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  const d = await r.json(); if (!Array.isArray(d) || !d.length) break; A.push(...d); if (d.length < 1000) break
}
console.log(`\nA list (Jarrod's Excel): ${A.length} documents`)

// Match on the K038/K124 sequence, which is what survives a rename.
const NUM = /6105A\s*K\s*(?:038|124)[-\s]?(\d{4})[-\s]?([A-Z]{1,4}\d{0,3})[-\s]?(\d{3,4})/i
const keyOf = (s) => { const m = NUM.exec(String(s ?? '')); return m ? `${m[1]}-${m[2].toUpperCase()}-${m[3]}` : null }

const seen = new Map()
for (const b of buckets) for (const f of b.files) {
  const k = keyOf(f.name) ?? keyOf(f.path)
  if (k) { if (!seen.has(k)) seen.set(k, []); seen.get(k).push(b.name) }
}
console.log(`distinct document numbers found in the folders: ${seen.size}`)

const disc = (r) => String(r.discipline || keyOf(r.legacy_docno)?.split('-')[1]?.[0] || '?').toUpperCase().slice(0, 1)
const covered = [], missing = []
for (const r of A) {
  const k = keyOf(r.legacy_docno) ?? keyOf(r.ai_docno) ?? keyOf(r.docno)
  if (k && seen.has(k)) covered.push({ r, k, buckets: seen.get(k) }); else missing.push({ r, k })
}
console.log(`\nCOVERAGE OF THE A LIST`)
console.log(`  matched into a decision folder : ${covered.length}  (${((covered.length / A.length) * 100).toFixed(1)}%)`)
console.log(`  NOT found in any folder        : ${missing.length}`)

const byDisc = {}
for (const r of A) { const d = disc(r); (byDisc[d] ??= { n: 0, cov: 0 }); byDisc[d].n++ }
for (const c of covered) byDisc[disc(c.r)].cov++
console.log(`\nBY DISCIPLINE (is it only the electrical side?)`)
const NAMES = { E: 'Electrical', C: 'Civil', M: 'Mechanical', I: 'Instrumentation', G: 'General', F: 'Process', S: 'Structural', P: 'Piping', B: 'Project Controls', A: 'Architectural', W: 'Civil earthworks', T: 'Telecoms', Q: 'Quality', D: 'Supply chain' }
for (const [d, v] of Object.entries(byDisc).sort((a, b) => b[1].n - a[1].n))
  console.log(`  ${String(v.cov).padStart(4)}/${String(v.n).padEnd(4)} ${((v.cov / v.n) * 100).toFixed(0).padStart(4)}%   ${d} — ${NAMES[d] ?? d}`)

console.log(`\nHOW THE COVERED ONES WERE SPLIT`)
const split = {}
for (const c of covered) for (const b of new Set(c.buckets)) split[b] = (split[b] || 0) + 1
for (const [k, v] of Object.entries(split).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
const dupes = covered.filter((c) => new Set(c.buckets).size > 1)
if (dupes.length) {
  console.log(`\n⚠ ${dupes.length} document(s) appear in MORE THAN ONE decision folder:`)
  for (const c of dupes.slice(0, 10)) console.log(`   ${c.k}  ->  ${[...new Set(c.buckets)].join('  +  ')}`)
}
if (missing.length) {
  console.log(`\nNOT COVERED — first 25:`)
  for (const m of missing.slice(0, 25))
    console.log(`   ${String(m.r.legacy_docno || m.r.ai_docno || m.r.temp_ref).padEnd(30)} ${disc(m.r)}  ${String(m.r.major_desc ?? '').slice(0, 46)}`)
}
// Anything in the folders that is NOT on the A list at all.
const aKeys = new Set(A.map((r) => keyOf(r.legacy_docno) ?? keyOf(r.ai_docno) ?? keyOf(r.docno)).filter(Boolean))
const extra = [...seen.keys()].filter((k) => !aKeys.has(k))
console.log(`\nIn the folders but NOT on the A list: ${extra.length}`)
for (const k of extra.slice(0, 12)) console.log(`   ${k}   (${[...new Set(seen.get(k))].join(', ')})`)
