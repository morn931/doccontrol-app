// One-off: Bernice saved her corrected 6105AK124-6200-IIDX-0001_A.pdf beside the original in
// the COLAB tender folder; the sync pulled it as a second drawing. Apply it as the RETURN of
// the original row (replace working copy, mark returned from document control, unlock the
// buttons, point the source at the new file) and remove the duplicate row.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const item = async (url) => (await fetch(`${G}/shares/${shareId(url)}/driveItem?$select=id,parentReference`, { headers: H })).json()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: rows } = await sb.from('prelim_document').select('*').ilike('document_number', '6105AK124-6200-IIDX-0001').order('created_at')
const orig = rows.find(r => r.source_file_name === '6105AK124-6200-IIDX-0001.pdf'), dup = rows.find(r => r.source_file_name === '6105AK124-6200-IIDX-0001_A.pdf')
if (!orig || !dup) { console.log('rows not as expected', rows.map(r => r.source_file_name)); process.exit(1) }
const src = await item(dup.source_file_url)
const bytes = await (await fetch(`${G}/drives/${src.parentReference.driveId}/items/${src.id}/content`, { headers: H })).arrayBuffer()
const wc = await item(orig.working_file_url)
const put = await fetch(`${G}/drives/${wc.parentReference.driveId}/items/${wc.id}/content`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/pdf' }, body: bytes })
if (!put.ok) throw new Error(`PUT ${put.status}`)
// the duplicate row first — it holds the _A url the original is about to take over
const dwc = await item(dup.working_file_url); if (dwc?.id) await fetch(`${G}/drives/${dwc.parentReference.driveId}/items/${dwc.id}`, { method: 'DELETE', headers: H })
await sb.from('prelim_quality_run').delete().eq('prelim_document_id', dup.id)
await sb.from('prelim_document').delete().eq('id', dup.id)
const now = new Date().toISOString()
const history = Array.isArray(orig.routing_history) ? orig.routing_history : []
history.push({ at: now, event: 'returned', by: 'bernicen@ppetech.co.za', file: dup.source_file_name, file_url: dup.source_file_url, note: 'corrected file saved beside the original in the tender folder; applied as the return by Morné',
  was: { routing: orig.routing, to: orig.routing_to_email, to_name: orig.routing_to_name, at: orig.routing_at, by: orig.routing_by_email, mailed_at: orig.routing_mailed_at }, comments: orig.markup_comments ?? [] })
const { error } = await sb.from('prelim_document').update({
  source_file_url: dup.source_file_url, source_file_name: dup.source_file_name,
  returned_at: now, returned_by_email: 'bernicen@ppetech.co.za', returned_from: 'document_control', returned_file_name: dup.source_file_name, returned_file_url: orig.working_file_url,
  markup_layer: null, markup_comments: null, markup_committed_at: null,
  routing: null, routing_at: null, routing_by_email: null, routing_to_email: null, routing_to_name: null, routing_mailed_at: null, routing_attached: null, routing_error: null,
  tender_stamped_at: null, tender_stamped_file_name: null, tender_stamped_file_url: null, tender_stamp_error: null, routing_history: history,
}).eq('id', orig.id)
if (error) throw error
console.log(`IIDX-0001: corrected file applied as a return from document control (was ${orig.routing} → ${orig.routing_to_email}); duplicate row removed`)
