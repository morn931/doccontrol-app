/**
 * Carry the Early Works (K038) document status from the CDDL into the MDDR.
 *
 * WHY THIS EXISTS. K038 was loaded into `mddr_entries` from the SharePoint Document
 * Index ONLY — every row carries `source_types: ["INDEX"]`. The Document Index is a
 * file listing: it knows a file exists, not what review state it is in. So all 3,281
 * K038 master rows have a NULL `aconex_doc_status`, and `computeProgressFromStatus()`
 * — which reads exactly that field plus the revision — had nothing to score. Early
 * Works therefore read ~0.5% complete in the MDDR while `cddl_doc`, holding the same
 * documents, reported ~91%. The data was never missing; it was never merged.
 *
 * WHAT IT DOES. Matches each K038 master row to its CDDL row on the normalised
 * document number and copies across `aconex_doc_status` and `revision` — the two
 * fields the agreed rules of credit are computed from. It writes NOTHING else, and it
 * does NOT compute progress: run `apply-rules-of-credit.ts` afterwards so the official
 * ladder does that, rather than this script re-implementing it.
 *
 * The CDDL is the right source: per the MDDR design, SDDR/CDDL own accurate dates and
 * status while the GMDR/Index fill gaps. `cddl_doc` is refreshed daily by the 06:00
 * scan, so re-running this stays correct.
 *
 *   npx tsx scripts/backfill-k038-status.ts            # dry run (no writes)
 *   npx tsx scripts/backfill-k038-status.ts --apply    # write
 *
 * Then:
 *   npx tsx scripts/apply-rules-of-credit.ts --apply
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Robust .env.local loader — `vercel env pull` can leave quoted values with a literal
// trailing \n inside the quotes, which breaks the Supabase host. Strip those.
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  const k = t.slice(0, i).trim()
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n|\\r/g, '').trim()
  if (!(k in process.env)) process.env[k] = v
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const PKG = 'K038'
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

type MddrRow = { id: string; document_number: string | null; normalized_document_number: string | null; aconex_doc_status: string | null; revision: string | null }
type CddlRow = { docno: string | null; aconex_doc_status: string | null; revision: string | null; retired: boolean | null }

async function pageAll<T>(table: string, cols: string, apply: (q: ReturnType<typeof db.from>) => unknown): Promise<T[]> {
  const out: T[] = []
  for (let off = 0; ; off += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(table).select(cols).order('id').range(off, off + 999)
    q = apply(q) ?? q
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  const write = process.argv.includes('--apply')

  const mddr = await pageAll<MddrRow>('mddr_entries', 'id,document_number,normalized_document_number,aconex_doc_status,revision',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q: any) => q.eq('package_code', PKG).eq('is_awarded', true))
  const cddlAll = await pageAll<CddlRow>('cddl_doc', 'docno,aconex_doc_status,revision,retired',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q: any) => q.eq('package_code', PKG))
  const cddl = cddlAll.filter((r) => !r.retired)
  const byDoc = new Map(cddl.map((r) => [norm(r.docno), r]))

  // Group by the target (status, revision) pair so one PATCH covers many rows —
  // 3,000 individual requests would be needlessly slow and rate-limit-prone.
  const groups = new Map<string, { status: string | null; revision: string | null; ids: string[] }>()
  let unmatched = 0, alreadySet = 0
  for (const r of mddr) {
    const hit = byDoc.get(norm(r.normalized_document_number)) ?? byDoc.get(norm(r.document_number))
    if (!hit) { unmatched++; continue }
    const status = hit.aconex_doc_status ?? null
    const revision = r.revision ?? hit.revision ?? null   // never overwrite a revision the master already holds
    if (r.aconex_doc_status === status && r.revision === revision) { alreadySet++; continue }
    const key = `${status ?? ''}|${revision ?? ''}`
    const g = groups.get(key) ?? { status, revision, ids: [] }
    g.ids.push(r.id)
    groups.set(key, g)
  }

  const toUpdate = [...groups.values()].reduce((a, g) => a + g.ids.length, 0)
  console.log(`K038 backfill — ${write ? 'APPLY' : 'DRY RUN'}`)
  console.log(`  master rows (awarded) ....... ${mddr.length}`)
  console.log(`  CDDL rows (active) .......... ${cddl.length}`)
  console.log(`  to update ................... ${toUpdate}`)
  console.log(`  already correct ............. ${alreadySet}`)
  console.log(`  unmatched (left untouched) .. ${unmatched}`)
  console.log(`\n  distinct (status, revision) combinations: ${groups.size}`)
  for (const g of [...groups.values()].sort((a, b) => b.ids.length - a.ids.length).slice(0, 8)) {
    console.log(`    ${String(g.status ?? '(none)').padEnd(32)} rev ${String(g.revision ?? '-').padEnd(6)} ${g.ids.length}`)
  }

  if (!write) { console.log('\n  (dry run — nothing written. Re-run with --apply)'); return }

  let done = 0
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 200) {
      const chunk = g.ids.slice(i, i + 200)
      const { error } = await db.from('mddr_entries')
        .update({ aconex_doc_status: g.status, revision: g.revision })
        .in('id', chunk)
      if (error) throw new Error(`update failed: ${error.message}`)
      done += chunk.length
      process.stdout.write(`\r  written ${done}/${toUpdate}`)
    }
  }
  console.log(`\n  done — ${done} rows updated.`)
  console.log('  NEXT: npx tsx scripts/apply-rules-of-credit.ts --apply')
}

main().catch((e) => { console.error(e); process.exit(1) })
