// Trial the tender stamp on REAL working copies before it goes behind the button:
// one landscape drawing, one portrait document, and a synthetic /Rotate 90 page.
// Writes stamped PDFs + page-1 PNGs to the k480 scratch folder for a look.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const { stampIssuedForTender } = await import('../lib/prelim/tender-stamp.ts')
const { PDFDocument, degrees } = await import('pdf-lib')
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const OUT = String.raw`C:\Users\mornec\AppData\Local\Temp\claude\k480\stamp-trial`
fs.mkdirSync(OUT, { recursive: true })

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['6105AK124-6200-EGAD-0005', '6105AK124-6200-GBOM-0002', '6105AK124-6200-ESCH-0001']
const { data: docs } = await sb.from('prelim_document').select('document_number, working_file_url, working_file_name').in('document_number', wanted)
for (const d of docs ?? []) {
  const r = await fetch(`${G}/shares/${shareId(d.working_file_url)}/driveItem/content`, { headers: H })
  const bytes = new Uint8Array(await r.arrayBuffer())
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const p0 = src.getPage(0); const { width, height } = p0.getSize()
  const { bytes: out, pages } = await stampIssuedForTender(bytes)
  const f = `${OUT}/${d.document_number}.pdf`; fs.writeFileSync(f, out)
  console.log(`${d.document_number}: ${pages} pages, page 1 ${Math.round(width)}x${Math.round(height)} rot ${p0.getRotation().angle} → ${f}`)
}
// synthetic rotated pages: take the first drawing, set /Rotate 90, 180, 270 on copies
const first = docs?.[0]
if (first) {
  const r = await fetch(`${G}/shares/${shareId(first.working_file_url)}/driveItem/content`, { headers: H })
  const bytes = new Uint8Array(await r.arrayBuffer())
  for (const rot of [90, 180, 270]) {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    doc.getPage(0).setRotation(degrees(rot))
    const { bytes: out } = await stampIssuedForTender(await doc.save())
    const f = `${OUT}/rot${rot}.pdf`; fs.writeFileSync(f, out); console.log(`rot ${rot} → ${f}`)
  }
}
