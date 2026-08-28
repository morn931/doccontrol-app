// The tiles, the package chips and the list must all describe the SAME population.
import { createClient } from '@supabase/supabase-js'
import { summarise } from '../lib/carryover/carryover'
import { applyGate, SCOPE } from '../lib/carryover/gate'

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').order('temp_ref').limit(2000)
  const all = (data ?? []) as never[]
  const g = applyGate(all, SCOPE)
  const d = summarise(g.rows)

  console.log(`scope "${SCOPE}"\n`)
  console.log(`TILES`)
  console.log(`  documents to place          ${d.total}`)
  console.log(`  ready to hand over          ${d.done}`)
  console.log(`  no project border           ${d.withoutBorder}`)
  console.log(`  number printed on the doc   ${d.withPrintedNumber}`)
  console.log(`  not yet opened              ${d.unread + d.failed}`)
  console.log(`\nPACKAGE CHIPS (each must filter to a non-zero list)`)
  let sum = 0
  for (const p of d.packages) { console.log(`  ${String(p.done).padStart(3)}/${String(p.docs).padEnd(4)} ${p.name}`); sum += p.docs }
  console.log(`  ${'—'.repeat(30)}`)
  console.log(`  chips sum to ${sum}  ${sum === d.total ? 'OK — matches the list' : '*** MISMATCH with ' + d.total + ' ***'}`)
  const zero = d.packages.filter((p) => p.docs === 0)
  console.log(`  chips that would filter to zero: ${zero.length}${zero.length ? ' -> ' + zero.map((z) => z.name).join(', ') : ''}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
