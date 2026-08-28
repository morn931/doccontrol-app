// The export must hold exactly what the page shows.
import { createClient } from '@supabase/supabase-js'
import { applyGate, SCOPE } from '../lib/carryover/gate'
import { isReady } from '../lib/carryover/types'
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').limit(2000)
  const all = (data ?? []) as never[]
  const g = applyGate(all, SCOPE)
  console.log(`register                 ${all.length}`)
  console.log(`scope "${SCOPE}" on screen  ${g.rows.length}`)
  console.log(`\nexport, default          ${g.rows.length}   (was ${all.length} — the bug)`)
  console.log(`export ?only=ready       ${g.rows.filter(isReady).length}`)
  console.log(`export ?all=1 (developer) ${all.length}`)
  console.log(`\nleft out                 ${all.length - g.rows.length}  = other batch + ${g.droppedNoEvidence} with no border and no project number`)
}
main().catch((e) => { console.error(e); process.exit(1) })
