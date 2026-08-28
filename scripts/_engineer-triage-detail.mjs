// Follow-ups on the triage scan: what the untouched documents actually are, what the
// loose root file is, and whether the 13 "extras" are known to us somewhere else.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('='); const k = t.slice(0, i).trim()
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const LINK = 'https://ppetechcoza.sharepoint.com/:f:/s/PPEExternalSharing/IgA4KuVFDEQoSJvvGBPklyVnAb6YEjzVXRyXKensudYehkw?e=KkFNAI'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const retry = async (fn, n = 4) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))) } } }

const tok = (await retry(async () => (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
})).json())).access_token
const H = { Authorization: `Bearer ${tok}` }
const root = await retry(async () => (await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId(LINK)}/driveItem`, { headers: H, cache: 'no-store' })).json())
const driveId = root.parentReference.driveId
const top = await retry(async () => (await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${root.id}/children?$top=999&$select=id,name,folder,file,lastModifiedDateTime,lastModifiedBy`, { headers: H })).json())

console.log('AT THE ROOT:')
for (const c of top.value ?? []) {
  const who = c.lastModifiedBy?.user?.displayName ?? '?'
  console.log(`  ${c.folder ? '[folder]' : '[file]  '} ${String(c.name).padEnd(46)} ${String(c.lastModifiedDateTime).slice(0, 16).replace('T', ' ')}  ${who}`)
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const q = async (path) => retry(async () => (await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json())
const A = await q('cddl_carryover?select=temp_ref,legacy_docno,ai_docno,docno,discipline,doc_type,major_desc,ai_title&source=eq.k038%20highlighted&order=legacy_docno&limit=1000')

const NUM = /6105A\s*K\s*(?:038|124)[-\s]?(\d{4})[-\s]?([A-Z]{1,4}\d{0,3})[-\s]?(\d{3,4})/i
const keyOf = (s) => { const m = NUM.exec(String(s ?? '')); return m ? `${m[1]}-${m[2].toUpperCase()}-${m[3]}` : null }

async function walk(itemId, out = []) {
  let url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=999&$select=id,name,folder`
  while (url) {
    const r = await retry(async () => (await fetch(url, { headers: H })).json())
    for (const c of r.value ?? []) { if (c.folder) await walk(c.id, out); else out.push(c.name) }
    url = r['@odata.nextLink']
  }
  return out
}
const seen = new Set()
for (const c of (top.value ?? []).filter((x) => x.folder)) for (const n of await walk(c.id)) { const k = keyOf(n); if (k) seen.add(k) }

const missing = A.filter((r) => { const k = keyOf(r.legacy_docno) ?? keyOf(r.ai_docno) ?? keyOf(r.docno); return !k || !seen.has(k) })
console.log(`\nNOT TRIAGED: ${missing.length} of ${A.length}`)
const byType = {}
for (const r of missing) {
  const k = keyOf(r.legacy_docno) ?? keyOf(r.ai_docno) ?? ''
  const code = k.split('-')[1] ?? '?'
  const label = `${String(r.discipline || code[0] || '?').toUpperCase()} · ${code}`
  ;(byType[label] ??= { n: 0, eg: r.ai_title || r.major_desc || '' }).n++
}
console.log('  by discipline and type code:')
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1].n - a[1].n))
  console.log(`   ${String(v.n).padStart(4)}  ${k.padEnd(14)} e.g. ${String(v.eg).slice(0, 58)}`)

// Are the 13 extras known to the carry-over at all?
const all = await q('cddl_carryover?select=temp_ref,source,legacy_docno,ai_docno,docno&limit=2000')
const allKeys = new Map()
for (const r of all) for (const v of [r.legacy_docno, r.ai_docno, r.docno]) { const k = keyOf(v); if (k && !allKeys.has(k)) allKeys.set(k, r) }
const aKeys = new Set(A.map((r) => keyOf(r.legacy_docno) ?? keyOf(r.ai_docno) ?? keyOf(r.docno)).filter(Boolean))
const extras = [...seen].filter((k) => !aKeys.has(k))
console.log(`\nIN THE FOLDERS BUT NOT ON THE A LIST: ${extras.length}`)
for (const k of extras) {
  const hit = allKeys.get(k)
  console.log(`   ${k.padEnd(18)} ${hit ? `known to the register as ${hit.temp_ref} (source: ${hit.source})` : 'NOT in the carry-over register at all'}`)
}
