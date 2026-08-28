// Open Ian's working copy at the root of the triage folder and see whether the 101
// instrumentation documents are decided there but not yet filed into the three folders.
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
if (!file) { console.log('no spreadsheet at the root'); process.exit(1) }
console.log(`FILE: ${file.name}`)
console.log(`saved ${String(file.lastModifiedDateTime).slice(0, 16).replace('T', ' ')} by ${file.lastModifiedBy?.user?.displayName ?? '?'}   ${(file.size / 1024).toFixed(0)} KB\n`)

const buf = Buffer.from(await (await retry(async () => fetch(file['@microsoft.graph.downloadUrl']))).arrayBuffer())
const wb = XLSX.read(buf, { type: 'buffer' })
console.log(`sheets: ${wb.SheetNames.join(' | ')}\n`)

const NUM = /6105A\s*K\s*(?:038|124)[-\s]?(\d{4})[-\s]?([A-Z]{1,4}\d{0,3})[-\s]?(\d{3,4})/i
const keyOf = (s) => { const m = NUM.exec(String(s ?? '')); return m ? `${m[1]}-${m[2].toUpperCase()}-${m[3]}` : null }
const S = (v) => (v == null ? '' : String(v).trim())

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
  const pop = aoa.filter((r) => r.some((c) => S(c) !== ''))
  console.log(`=== ${name} — ${pop.length} populated rows, range ${ws['!ref']} ===`)
  // Find the header row: the one that mentions a document number.
  const hi = aoa.findIndex((r) => r.some((c) => /document\s*(no|number)|drawing\s*(no|number)/i.test(S(c))))
  if (hi >= 0) console.log(`  header row ${hi + 1}: ${aoa[hi].map(S).filter(Boolean).slice(0, 14).join(' | ')}`)
  // Which rows carry an instrumentation number, and what sits beside them?
  const instr = []
  for (let i = 0; i < aoa.length; i++) {
    const joined = aoa[i].map(S).join(' ')
    const k = keyOf(joined)
    if (k && /^\d{4}-I/i.test(k)) instr.push({ row: i + 1, k, cells: aoa[i].map(S) })
  }
  console.log(`  rows carrying an INSTRUMENTATION number: ${instr.length}`)
  if (instr.length) {
    const cols = Math.max(...instr.map((r) => r.cells.length))
    // Show only columns that actually carry something on instrumentation rows.
    const useful = []
    for (let c = 0; c < cols; c++) {
      const filled = instr.filter((r) => S(r.cells[c]) !== '').length
      if (filled > 0) useful.push({ c, filled, header: hi >= 0 ? S(aoa[hi][c]) : '' })
    }
    console.log('  columns populated on those rows:')
    for (const u of useful) console.log(`     col ${String(u.c).padStart(2)}  ${String(u.filled).padStart(4)} filled  "${u.header}"`)
    console.log('  first 12 instrumentation rows:')
    for (const r of instr.slice(0, 12))
      console.log(`     ${String(r.row).padStart(4)}  ${r.k.padEnd(16)} ${useful.map((u) => S(r.cells[u.c])).filter(Boolean).slice(0, 6).join(' | ').slice(0, 120)}`)
  }
  console.log()
}
