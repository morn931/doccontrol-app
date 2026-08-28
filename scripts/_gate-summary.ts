import { createClient } from '@supabase/supabase-js'
import { applyGate, SCOPE } from '../lib/carryover/gate'
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').order('temp_ref').limit(2000)
  const all = (data ?? []) as never[]
  for (const scope of ['A-released', 'B'] as const) {
    const g = applyGate(all, scope)
    console.log(`\nSCOPE "${scope}"${scope === SCOPE ? '   <- LIVE' : ''}`)
    console.log(`  visible            ${g.visibleTotal}`)
    console.log(`    already done     ${g.visibleReady}`)
    console.log(`    still to do      ${g.visibleTotal - g.visibleReady}`)
    console.log(`    engineering-released ${g.visibleReleased} of ${g.visibleTotal}`)
    console.log(`  hidden             ${g.hidden}   (of those, finished: ${g.hiddenButFinished})`)
    console.log(`  released, out of scope ${g.releasedOutOfScope}`)
    if (scope === 'B') {
      const pk: Record<string, {n:number;done:number}> = {}
      for (const r of g.rows as any[]) {
        const k = r.target_package ?? '?'
        pk[k] ??= { n: 0, done: 0 }
        pk[k].n++
        if (String(r.docno ?? '').trim() && String(r.wbs ?? '').trim()) pk[k].done++
      }
      console.log(`  packages:`)
      for (const [k, v] of Object.entries(pk).sort((a, b) => b[1].n - a[1].n))
        console.log(`     ${String(v.done).padStart(3)}/${String(v.n).padEnd(4)} ${k}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
