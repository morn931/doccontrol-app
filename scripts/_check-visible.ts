import { createClient } from '@supabase/supabase-js'
import { isVisible, hasEvidence } from '../lib/carryover/gate'
const refs = ['CO-132','CO-139','CO-140','CO-142','CO-146','CO-147','CO-148','CO-149','CO-152','CO-154']
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').in('temp_ref', refs)
  for (const r of (data ?? []) as any[])
    console.log(`${r.temp_ref}  border=${String(r.ai_has_border).padEnd(5)} evidence=${String(hasEvidence(r)).padEnd(5)} VISIBLE=${isVisible(r)}   ai_docno="${r.ai_docno ?? ''}"`)
  const { data: all } = await sb.from('cddl_carryover').select('*').limit(2000)
  console.log(`\nvisible now: ${(all ?? []).filter((r: any) => isVisible(r)).length}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
