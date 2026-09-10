// Issue a drawing for tender STRAIGHT from its COLAB source, the way the review tool would after
// a Ready-for-tender call — for a file the lead placed in the handover tree and ruled issued
// without a room review (Marnus's four ESCH cable-schedule PDFs, 10 Sep). Per document:
//   1. the source is found in the open session whose folder holds it
//   2. the session gets a row for it if it has none (same pull as the tool: working copy + row)
//   3. the working copy is stamped and filed as "Issued for Tender/<name> - ISSUED FOR TENDER.pdf"
//      beside the source, and the row is set Ready for tender by the person named
// The populate step then carries the stamped copy into the pack. Sources are never written to.
//   npx tsx scripts/prelim-issue-direct.ts <docno…> --by=<email> [--write]
import './_env'   // first: the graph lib reads MICROSOFT_* at module load
import { createClient } from '@supabase/supabase-js'
import { listFolderTree, pullFilesIntoSession, TENDER_FOLDER, type PullSession } from '../lib/prelim/pull'
import { getFileBytesByUrl, uploadBytesBesideItem } from '../lib/services/graph'
import { stampIssuedForTender, tenderCopyName } from '../lib/prelim/tender-stamp'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const BY = args.find(a => a.startsWith('--by='))?.slice(5) ?? 'mornec@ppetech.co.za'
const DOCS = args.filter(a => /^6105A/i.test(a)).map(s => s.toUpperCase())
if (!DOCS.length) { console.error('usage: npx tsx scripts/prelim-issue-direct.ts <docno…> --by=email [--write]'); process.exit(1) }
const stemOf = (s: string) => (s.match(/(6105A[A-Z0-9]+-\d{4}-[A-Z]-?[A-Z0-9]{3}-\d{4})/i)?.[1]?.replace(/-(\d{4})-([A-Z])-([A-Z0-9]{3})-/i, '-$1-$2$3-') ?? '').toUpperCase()

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: sessions } = await sb.from('prelim_session').select('id, title, status, source_site_url, source_library, source_folder').eq('status', 'open')
  // every file in every open session's tree, once
  const trees = new Map<string, { session: PullSession; files: { name: string; webUrl: string }[] }>()
  for (const s of (sessions ?? []) as PullSession[]) trees.set(s.id, { session: s, files: (await listFolderTree(s, s.source_folder)).filter(f => !/ISSUED FOR TENDER/i.test(f.name)) })
  for (const dn of DOCS) {
    const hit = [...trees.values()].map(t => ({ session: t.session, file: t.files.find(f => stemOf(f.name) === dn && /\.pdf$/i.test(f.name)) })).find(h => h.file)
    if (!hit) { console.log(`  ?   ${dn}: no PDF with this number in any open session's COLAB folder`); continue }
    const { session, file } = hit as { session: PullSession; file: { name: string; webUrl: string } }
    let { data: row } = await sb.from('prelim_document').select('id, routing, working_file_url, source_file_name, source_file_url, tender_stamped_file_url').eq('session_id', session.id).eq('document_number', dn).maybeSingle()
    if (!row) { const { data: byUrl } = await sb.from('prelim_document').select('id, routing, working_file_url, source_file_name, source_file_url, tender_stamped_file_url').eq('session_id', session.id).eq('source_file_url', file.webUrl).maybeSingle(); row = byUrl }
    console.log(`\n${dn}  [${session.title.split(' — ')[0]}]  ${file.name}  · row ${row ? `exists (call ${row.routing ?? 'none'}${row.tender_stamped_file_url ? ', stamped' : ''})` : 'none yet'}`)
    if (row?.routing === 'ready_for_tender' && row.tender_stamped_file_url) { console.log('  already issued — nothing to do'); continue }
    if (!WRITE) { console.log(`  would ${row ? '' : 'pull into the session, '}stamp and file "${tenderCopyName(file.name)}" beside the source, and set Ready for tender by ${BY}`); continue }
    if (!row) {
      const [res] = await pullFilesIntoSession(session, [file], BY)
      if (!res.ok || !res.docId) { console.log(`  FAILED pull: ${res.error ?? res.skipped}`); continue }
      const { data: fresh } = await sb.from('prelim_document').select('id, routing, working_file_url, source_file_name, source_file_url, tender_stamped_file_url').eq('id', res.docId).single(); row = fresh
      console.log(`  pulled into the session (row ${res.docId}, number ${res.documentNumber ?? dn})`)
      if (!res.documentNumber) await sb.from('prelim_document').update({ document_number: dn }).eq('id', res.docId)
    }
    const src = await getFileBytesByUrl(row!.working_file_url)
    const { bytes, pages } = await stampIssuedForTender(src)
    const name = tenderCopyName(row!.source_file_name.replace(/\.[^.]+$/, '.pdf'))
    const up = await uploadBytesBesideItem(row!.source_file_url, TENDER_FOLDER, name, bytes)
    const now = new Date().toISOString()
    const { error } = await sb.from('prelim_document').update({ routing: 'ready_for_tender', routing_at: now, routing_by_email: BY, routing_to_email: null, routing_to_name: null, routing_mailed_at: null, routing_attached: null, routing_error: null, tender_stamped_at: now, tender_stamped_file_name: name, tender_stamped_file_url: up.webUrl, tender_stamp_error: null }).eq('id', row!.id)
    console.log(error ? `  FAILED row update: ${error.message}` : `  ok  stamped ${pages} p → ${name} · Ready for tender by ${BY}`)
  }
  if (!WRITE) console.log('\n(dry run — add --write)')
}
main().catch(e => { console.error(e); process.exit(1) })
