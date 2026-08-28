// The CDDL_Ian sheet carries an "Action (Ian)" column. Is it filled for the 101
// instrumentation documents, or only for the electrical ones he has already filed?
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
const wb = XLSX.read(buf, { type: 'buffer' })
const aoa = XLSX.utils.sheet_to_json(wb.Sheets['CDDL_Ian'], { header: 1, defval: '', raw: false })

const S = (v) => (v == null ? '' : String(v).trim())
const head = aoa[0].map(S)
const ACT = head.findIndex((h) => /^action/i.test(h))
const DISC = head.findIndex((h) => /^discipline$/i.test(h))
const RDMC = head.findIndex((h) => /rdmc document number/i.test(h))
const TITLE = head.findIndex((h) => /full title/i.test(h))
console.log(`"Action (Ian)" is column ${ACT} ("${head[ACT]}")\n`)

const rows = aoa.slice(1).filter((r) => S(r[RDMC]) || S(r[DISC]))
console.log(`data rows: ${rows.length}`)

const byDisc = {}
for (const r of rows) {
  const d = S(r[DISC]).toUpperCase() || '?'
  const a = S(r[ACT])
  ;(byDisc[d] ??= { n: 0, filled: 0, values: {} })
  byDisc[d].n++
  if (a) { byDisc[d].filled++; byDisc[d].values[a] = (byDisc[d].values[a] || 0) + 1 }
}
console.log('\nACTION FILLED IN, BY DISCIPLINE')
for (const [d, v] of Object.entries(byDisc).sort((a, b) => b[1].n - a[1].n)) {
  const pct = v.n ? ((v.filled / v.n) * 100).toFixed(0) : '0'
  console.log(`  ${d.padEnd(3)} ${String(v.filled).padStart(4)}/${String(v.n).padEnd(4)} ${pct.padStart(4)}%   ${Object.entries(v.values).map(([k, c]) => `${k} (${c})`).join(' · ') || '— nothing recorded —'}`)
}

const all = {}
for (const r of rows) { const a = S(r[ACT]); if (a) all[a] = (all[a] || 0) + 1 }
console.log('\nEVERY ACTION VALUE USED')
for (const [k, v] of Object.entries(all).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)

const instrBlank = rows.filter((r) => S(r[DISC]).toUpperCase() === 'I' && !S(r[ACT]))
console.log(`\nINSTRUMENTATION ROWS WITH NO ACTION: ${instrBlank.length}`)
for (const r of instrBlank.slice(0, 8)) console.log(`   ${S(r[RDMC]).padEnd(30)} ${S(r[TITLE]).slice(0, 62)}`)
