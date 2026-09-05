// Run the prelim quality check over every drawing in a session, from the command line — the
// same read and the same writes as POST /api/prelim/documents/[id]/quality, for when the
// operator is not at a browser. usage: node scripts/prelim-quality-run.mjs <sessionId>
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const { checkDocumentQuality, openCount } = await import('../lib/prelim/quality-check.ts')
const sessionId = process.argv[2]; if (!sessionId) { console.error('usage: node scripts/prelim-quality-run.mjs <sessionId>'); process.exit(1) }
const BY = 'mornec@ppetech.co.za'
const retry = async (fn, n = 5) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 4000 * (i + 1))) } } }
const tok = (await retry(async () => (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json())).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const shareId = (l) => 'u!' + Buffer.from(l, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const gjson = (u) => retry(async () => { const r = await fetch(G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 60)}`); return r.json() })
const gbytes = (u) => retry(async () => { const r = await fetch(G + u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 60)}`); return r.arrayBuffer() })
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: session } = await sb.from('prelim_session').select('id, title').eq('id', sessionId).single()
const { data: docs } = await sb.from('prelim_document').select('id, document_number, revision, title, discipline, document_type, source_file_name, source_file_url, cddl_doc_id, handed_over_batch_id').eq('session_id', sessionId).order('created_at')
console.log(`${session?.title}: ${docs?.length ?? 0} drawings`)
let clear = 0, withIssues = 0, failed = 0, totalOpen = 0
for (const d of docs ?? []) {
  if (d.handed_over_batch_id) continue
  const label = `${d.document_number ?? d.source_file_name}`
  try {
    const item = await gjson(`/shares/${shareId(d.source_file_url)}/driveItem?$select=id,name,lastModifiedDateTime,parentReference`)
    const isPdf = /\.pdf$/i.test(item.name)
    const bytes = await gbytes(`/drives/${item.parentReference.driveId}/items/${item.id}/content${isPdf ? '' : '?format=pdf'}`)
    let expected = { document_number: d.document_number, title: d.title, revision: d.revision, discipline: d.discipline, document_type: d.document_type }
    if (d.cddl_doc_id) { const { data: c } = await sb.from('cddl_doc').select('docno, title, revision, discipline, doc_type').eq('id', d.cddl_doc_id).maybeSingle(); if (c) expected = { document_number: c.docno, title: c.title ?? d.title, revision: c.revision ?? d.revision, discipline: c.discipline ?? d.discipline, document_type: c.doc_type ?? d.document_type } }
    const out = await retry(async () => { const o = await checkDocumentQuality({ pdfBytes: Buffer.from(bytes), fileName: item.name, expected, converted: !isPdf }); if (!o.ok) throw new Error(o.error); return o }, 2)
    const open = openCount(out.report), now = new Date().toISOString()
    await sb.from('prelim_quality_run').insert({ prelim_document_id: d.id, checked_by_email: BY, source_file_url: d.source_file_url, source_modified_at: item.lastModifiedDateTime ?? null, open_count: open, report: out.report })
    await sb.from('prelim_document').update({ quality_latest: out.report, quality_open: open, quality_checked_at: now, quality_source_modified_at: item.lastModifiedDateTime ?? null }).eq('id', d.id)
    totalOpen += open; if (open) withIssues++; else clear++
    const majors = out.report.issues.filter(i => i.severity === 'major').length
    console.log(`  ${open ? `${String(open).padStart(2)} open${majors ? ` (${majors} major)` : ''}` : '   clear     '}  ${label}  ${open ? '— ' + out.report.issues.slice(0, 2).map(i => i.description.slice(0, 80)).join(' | ') : ''}`)
  } catch (e) {
    failed++
    await sb.from('prelim_quality_run').insert({ prelim_document_id: d.id, checked_by_email: BY, source_file_url: d.source_file_url, open_count: 0, report: {}, error: String(e?.message ?? e) }).then(() => null, () => null)
    console.log(`   FAILED      ${label}: ${e?.message ?? e}`)
  }
}
console.log(`\nclear ${clear} · with issues ${withIssues} (${totalOpen} open) · failed ${failed}`)
