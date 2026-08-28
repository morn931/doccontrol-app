// "Keep only what we can truly say we spent time on" — a border, or a number.
// Check the effect before wiring it in, and see WHAT gets dropped.
import { createClient } from '@supabase/supabase-js'
import { applyGate } from '../lib/carryover/gate'

const S = (v: unknown) => String(v ?? '').trim()
const has = (v: unknown) => S(v) !== ''

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').order('temp_ref').limit(2000)
  const all = (data ?? []) as any[]

  for (const scope of ['B', 'A-released'] as const) {
    const rows = applyGate(all as never[], scope).rows as any[]
    const border = (r: any) => r.ai_has_border === true
    const anyNumber = (r: any) => has(r.docno) || has(r.ai_docno) || has(r.legacy_docno)
    const keep = rows.filter((r) => border(r) || anyNumber(r))
    const drop = rows.filter((r) => !(border(r) || anyNumber(r)))
    console.log(`\nSCOPE ${scope}: ${rows.length} rows`)
    console.log(`  KEEP (border or a number) : ${keep.length}`)
    console.log(`  DROP (neither)            : ${drop.length}`)
    console.log(`     of the kept: border ${keep.filter(border).length} · a number ${keep.filter(anyNumber).length} · both ${keep.filter((r) => border(r) && anyNumber(r)).length}`)
    console.log(`     kept that are already finished: ${keep.filter((r) => has(r.docno) && has(r.wbs)).length}`)
    // Would the rule ever drop something already finished? It must not.
    const droppedDone = drop.filter((r) => has(r.docno) && has(r.wbs))
    console.log(`     DROPPED but already finished: ${droppedDone.length} ${droppedDone.length ? '*** would lose completed work ***' : ''}`)
    if (scope === 'B') {
      const byPkg: Record<string, { n: number; keep: number }> = {}
      for (const r of rows) { const k = r.target_package ?? '?'; byPkg[k] ??= { n: 0, keep: 0 }; byPkg[k].n++; if (border(r) || anyNumber(r)) byPkg[k].keep++ }
      console.log('  by package (keep / total):')
      for (const [k, v] of Object.entries(byPkg).sort((a, b) => b[1].n - a[1].n))
        console.log(`     ${String(v.keep).padStart(4)}/${String(v.n).padEnd(4)} ${k}`)
      console.log('  examples of what gets dropped:')
      for (const r of drop.slice(0, 8))
        console.log(`     ${r.temp_ref}  border=${r.ai_has_border}  "${S(r.ai_title).slice(0, 52) || S(r.source_path).split('/').pop()?.slice(0, 52)}"`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
