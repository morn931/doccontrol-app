// Work out exactly which carry-over rows the "Proceed with new number" decision releases,
// and — the part that matters — whether hiding everything else would take away rows the
// controllers have ALREADY finished.
import fs from 'node:fs'
import * as XLSX from 'xlsx'

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
const top = await retry(async () => (await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${root.id}/children?$top=999`, { headers: H })).json())
const file = (top.value ?? []).find((c) => !c.folder && /\.xlsx?$/i.test(c.name))
const buf = Buffer.from(await (await retry(async () => fetch(file['@microsoft.graph.downloadUrl']))).arrayBuffer())
const aoa = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: 'buffer' }).Sheets['CDDL_Ian'], { header: 1, defval: '', raw: false })

const S = (v) => (v == null ? '' : String(v).trim())
const head = aoa[0].map(S)
const ACT = head.findIndex((h) => /^action/i.test(h))
const RDMC = head.findIndex((h) => /rdmc document number/i.test(h))
const DISC = head.findIndex((h) => /^discipline$/i.test(h))
// "Proceed  with new number" appears once with a double space — normalise, or one document
// silently drops out of the release.
const norm = (a) => S(a).toLowerCase().replace(/\s+/g, ' ')
const proceed = aoa.slice(1).filter((r) => norm(r[ACT]) === 'proceed with new number')
console.log(`"Proceed with new number" rows in Ian's sheet: ${proceed.length}`)
const byD = {}
for (const r of proceed) { const d = S(r[DISC]).toUpperCase(); byD[d] = (byD[d] || 0) + 1 }
console.log(`  by discipline: ${Object.entries(byD).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

const NUM = /6105A\s*K\s*(?:038|124)[-\s]?(\d{4})[-\s]?([A-Z]{1,4}\d{0,3})[-\s]?(\d{3,4})/i
const keyOf = (s) => { const m = NUM.exec(String(s ?? '')); return m ? `${m[1]}-${m[2].toUpperCase()}-${m[3]}` : null }
const releaseKeys = new Set(proceed.map((r) => keyOf(r[RDMC])).filter(Boolean))
console.log(`  distinct document numbers: ${releaseKeys.size}`)

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const q = async (p) => retry(async () => (await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json())
const A = await q('cddl_carryover?select=temp_ref,legacy_docno,ai_docno,docno,wbs,discipline&source=eq.k038%20highlighted&limit=1000')
const has = (v) => !!S(v)
const ready = (r) => has(r.docno) && has(r.wbs)
const rowKey = (r) => keyOf(r.legacy_docno) ?? keyOf(r.ai_docno) ?? keyOf(r.docno)

const released = A.filter((r) => { const k = rowKey(r); return k && releaseKeys.has(k) })
console.log(`\nA rows matching the release: ${released.length} of ${A.length}`)
const unmatched = [...releaseKeys].filter((k) => !A.some((r) => rowKey(r) === k))
console.log(`release numbers with NO row in the A list: ${unmatched.length}`)
for (const k of unmatched.slice(0, 10)) console.log(`   ${k}`)

console.log(`\n── THE THING TO CHECK BEFORE HIDING ANYTHING ──`)
const readyA = A.filter(ready)
const readyReleased = readyA.filter((r) => { const k = rowKey(r); return k && releaseKeys.has(k) })
const readyHidden = readyA.filter((r) => { const k = rowKey(r); return !k || !releaseKeys.has(k) })
console.log(`A rows already finished (number + area): ${readyA.length}`)
console.log(`  of those, inside the release  : ${readyReleased.length}`)
console.log(`  of those, WOULD BE HIDDEN     : ${readyHidden.length}   <- finished work that would vanish`)
console.log(`\nreleased rows still to do: ${released.filter((r) => !ready(r)).length} of ${released.length}`)
for (const r of readyHidden.slice(0, 10)) console.log(`   hidden-but-done: ${S(r.legacy_docno) || r.temp_ref}  ->  ${r.docno}`)
