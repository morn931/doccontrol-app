// Which document numbers sit in MORE THAN ONE open session, where each copy's source points,
// whether that source still exists in COLAB, and what state each copy is in.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const exists = async (url) => (await fetch(`${G}/shares/${shareId(url)}/driveItem?$select=id`, { headers: H })).ok
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: docs } = await sb.from('prelim_document').select('id, document_number, source_file_url, routing, returned_at, markup_committed_at, markup_comments, tender_stamped_file_url, created_at, prelim_session!inner(title, status)').eq('prelim_session.status', 'open')
const by = new Map()
for (const d of docs) { if (!d.document_number) continue; const k = d.document_number.toUpperCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(d) }
const dupes = [...by].filter(([, xs]) => xs.length > 1)
console.log(`open-session drawings ${docs.length} · numbers in more than one session: ${dupes.length}`)
const state = (d) => d.routing ?? (d.returned_at ? 'returned' : (d.markup_committed_at || (d.markup_comments ?? []).length) ? 'in review' : 'not started')
const folderOf = (u) => decodeURIComponent(u).replace(/^.*\/COLAB\//, '').replace(/\/[^/]+$/, '')
for (const [no, xs] of dupes.sort()) {
  console.log(`\n${no}`)
  for (const d of xs) console.log(`   ${d.prelim_session.title.replace(/ — .*$/, '').padEnd(28)} ${state(d).padEnd(16)} source ${await exists(d.source_file_url) ? 'EXISTS ' : 'MISSING'}  ${folderOf(d.source_file_url)}${d.tender_stamped_file_url ? '  · stamped copy: ' + folderOf(d.tender_stamped_file_url) : ''}`)
}
