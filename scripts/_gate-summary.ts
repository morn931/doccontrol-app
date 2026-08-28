import { createClient } from '@supabase/supabase-js'
import { applyGate } from '../lib/carryover/gate'
import { isReady } from '../lib/carryover/types'
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').order('temp_ref').limit(2000)
  const all = (data ?? []) as never[]
  const g = applyGate(all)
  const A = all.filter((r: any) => r.source === 'k038 highlighted')
  console.log(`register              ${all.length}   (A ${A.length} · B ${all.length - A.length})`)
  console.log(`VISIBLE               ${g.releasedTotal}   all from A`)
  console.log(`  already done        ${g.releasedReady}`)
  console.log(`  still to do         ${g.releasedTotal - g.releasedReady}`)
  console.log(`hidden                ${g.hidden}`)
  console.log(`  of those, finished  ${g.hiddenButFinished}   (parked, nothing lost)`)
  console.log(`released but held (B) ${g.releasedHeldBackB}`)
  const aDone = A.filter(isReady).length
  console.log(`\nA finished overall     ${aDone}   of which parked ${aDone - g.releasedReady}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
