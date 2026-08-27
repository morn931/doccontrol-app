// Does the extractor find every K038 number that is really there, and reject the rest?
import { createClient } from '@supabase/supabase-js'
import { originalK038, extractK038, k038Disagrees } from '../lib/carryover/k038'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
async function main() {
  const { data, error } = await sb.from('cddl_carryover')
    .select('temp_ref,docno,wbs,legacy_docno,ai_docno').order('temp_ref').limit(2000)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const mentions = (v: unknown) => /K\s*038/i.test(String(v ?? ''))
  const has = (v: unknown) => !!String(v ?? '').trim()

  const found = rows.filter((r) => originalK038(r))
  const mentioned = rows.filter((r) => mentions(r.legacy_docno) || mentions(r.ai_docno))
  console.log(`rows                              : ${rows.length}`)
  console.log(`mention K038 anywhere             : ${mentioned.length}`)
  console.log(`extractor returns a clean number  : ${found.length}`)
  console.log(`  with a new K124 number assigned : ${found.filter((r) => has(r.docno)).length}`)
  console.log(`  fully ready                     : ${found.filter((r) => has(r.docno) && has(r.wbs)).length}`)

  const missed = mentioned.filter((r) => !originalK038(r))
  console.log(`\nMENTIONS K038 BUT REJECTED BY THE PATTERN: ${missed.length}`)
  for (const r of missed.slice(0, 12)) console.log(`   file="${r.legacy_docno ?? ''}"  doc="${String(r.ai_docno ?? '').slice(0, 60)}"`)

  const dis = rows.filter(k038Disagrees)
  console.log(`\nfilename vs title block disagree  : ${dis.length}`)
  for (const r of dis.slice(0, 6)) console.log(`   using ${extractK038(r.legacy_docno)}  (document says ${extractK038(r.ai_docno)})`)

  const fromDoc = rows.filter((r) => !extractK038(r.legacy_docno) && extractK038(r.ai_docno))
  console.log(`\nfell back to the title block      : ${fromDoc.length}`)
  for (const r of fromDoc.slice(0, 5)) console.log(`   ${extractK038(r.ai_docno)}   (filename: ${r.legacy_docno ?? '—'})`)
}
main().catch((e) => { console.error(e); process.exit(1) })
