// Tighten "has a number" to mean a PROJECT number. A vendor's own datasheet code is not
// evidence PPE produced anything.
import { createClient } from '@supabase/supabase-js'
import { applyGate } from '../lib/carryover/gate'

const S = (v: unknown) => String(v ?? '').trim()
// The two shapes a project number takes here: the RDMC drawing number, and PPE's own
// Q-quote document number. Both appear with and without separators.
const PROJECT_NUM = /(6105A\s*K\s*\d{3}[-\s]?\d{4})|(Q\s*-?\s*24050972)/i
const hasProjectNumber = (r: any) => [r.docno, r.ai_docno, r.legacy_docno].some((v) => PROJECT_NUM.test(S(v)))

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('cddl_carryover').select('*').order('temp_ref').limit(2000)
  const all = (data ?? []) as any[]

  for (const scope of ['B', 'A-released'] as const) {
    const rows = (applyGate(all as never[], scope).rows as any[])
    const border = (r: any) => r.ai_has_border === true
    const keep = rows.filter((r) => border(r) || hasProjectNumber(r))
    const drop = rows.filter((r) => !(border(r) || hasProjectNumber(r)))
    const droppedDone = drop.filter((r) => S(r.docno) && S(r.wbs))
    console.log(`\nSCOPE ${scope}: currently visible ${rows.length}`)
    console.log(`  would KEEP ${keep.length}   would DROP ${drop.length}`)
    console.log(`  DROPPED but already finished: ${droppedDone.length} ${droppedDone.length ? '*** must not happen ***' : ''}`)
    if (scope === 'B') {
      console.log('  examples dropped (vendor literature):')
      for (const r of drop.slice(0, 10))
        console.log(`     ${r.temp_ref}  border=${String(r.ai_has_border).padEnd(5)} ai_docno="${S(r.ai_docno).slice(0, 28)}"  ${S(r.ai_title).slice(0, 40)}`)
      const byPkg: Record<string, { n: number; k: number }> = {}
      for (const r of rows) { const p = r.target_package ?? '?'; byPkg[p] ??= { n: 0, k: 0 }; byPkg[p].n++; if (border(r) || hasProjectNumber(r)) byPkg[p].k++ }
      console.log('  by package (keep / now):')
      for (const [k, v] of Object.entries(byPkg).sort((a, b) => b[1].n - a[1].n)) console.log(`     ${String(v.k).padStart(4)}/${String(v.n).padEnd(4)} ${k}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
