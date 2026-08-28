import { createClient } from '@supabase/supabase-js'
import { applyGate, numberKey } from '../lib/carryover/gate'
import { isReady } from '../lib/carryover/types'
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').order('temp_ref').limit(2000)
  const g = applyGate((data ?? []) as never[])
  const seen = new Map<string, any[]>()
  for (const r of g.rows as any[]) {
    const k = numberKey(r.legacy_docno) ?? numberKey(r.ai_docno) ?? numberKey(r.docno) ?? r.temp_ref
    seen.set(k, [...(seen.get(k) ?? []), r])
  }
  console.log(`visible rows ${g.rows.length}, distinct numbers ${seen.size}`)
  for (const [k, rs] of seen) if (rs.length > 1)
    console.log(`  DUPLICATE ${k}: ${rs.map((r) => `${r.temp_ref} (${r.source})`).join('  +  ')}`)
  const B = (g.rows as any[]).filter((r) => r.source === 'tender folder')
  console.log(`\nreleased rows that came from B (tender folders): ${B.length}`)
  for (const r of B) console.log(`   ${r.temp_ref}  ${r.legacy_docno ?? r.ai_docno ?? ''}  [${r.target_package}]  ${isReady(r) ? 'done' : 'to do'}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
