// Re-make every existing stamped tender copy with the current stamp placement (drawings:
// revision table bottom left; documents: top right), keeping each copy's ORIGINAL stamp date,
// and replace the copy in COLAB under the same name.
//   node scripts/prelim-restamp.mjs           dry run
//   node scripts/prelim-restamp.mjs --write
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const { stampIssuedForTender, tenderStampDate } = await import('../lib/prelim/tender-stamp.ts')
const WRITE = process.argv.includes('--write')
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const item = async (url) => (await fetch(`${G}/shares/${shareId(url)}/driveItem?$select=id,name,parentReference`, { headers: H })).json()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: docs } = await sb.from('prelim_document').select('id, document_number, working_file_url, tender_stamped_at, tender_stamped_file_url, tender_stamped_file_name, prelim_session!inner(status)').eq('prelim_session.status', 'open').not('tender_stamped_file_url', 'is', null)
console.log(`stamped copies to re-make: ${docs.length}`)
let n = 0
for (const d of docs) {
  const date = tenderStampDate(new Date(d.tender_stamped_at))
  if (!WRITE) { console.log(`   ${d.document_number}  stamped ${date}`); continue }
  try {
    const wc = await item(d.working_file_url)
    const bytes = new Uint8Array(await (await fetch(`${G}/drives/${wc.parentReference.driveId}/items/${wc.id}/content`, { headers: H })).arrayBuffer())
    const { bytes: out, pages } = await stampIssuedForTender(bytes, date)
    const old = await item(d.tender_stamped_file_url)
    const put = await fetch(`${G}/drives/${old.parentReference.driveId}/items/${old.id}/content`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/pdf' }, body: out })
    if (!put.ok) throw new Error(`PUT ${put.status}`)
    n++; console.log(`   ✓ ${d.document_number}  ${pages} page${pages === 1 ? '' : 's'}  stamped ${date}`)
  } catch (e) { console.log(`   ✗ ${d.document_number}: ${e.message}`) }
}
if (!WRITE) console.log('\n(dry run — pass --write)'); else console.log(`\nre-stamped ${n} of ${docs.length}`)
