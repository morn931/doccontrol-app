/**
 * Apply the agreed Rules-of-Credit progress to the MDDR for the packages that use it,
 * leaving ABB (SDDR-reported %) untouched:
 *   · Siemens K125 — from review_outcome_code + revision (computeProgress)
 *   · PPE     K124 — from aconex_doc_status + revision (computeProgressFromStatus),
 *                    RES - Reserved Placeholder docs skipped entirely.
 * Writes progress_percent + progress_milestone + progress_source='rules_of_credit'
 * (the sync guard then leaves these rows alone). Re-runnable after register updates.
 *
 *   npx tsx scripts/apply-rules-of-credit.ts            # dry run (no writes)
 *   npx tsx scripts/apply-rules-of-credit.ts --apply    # write
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { computeProgress, computeProgressFromStatus } from '../lib/mddr/rules-of-credit'

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

const isRES = (s: unknown) => String(s ?? '').toUpperCase().startsWith('RES')
type Row = { id: string; progress_percent: number | null; review_outcome_code: string | null; aconex_doc_status: string | null; revision: string | null }

async function fetchPkg(pkg: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from('mddr_entries')
      .select('id,progress_percent,review_outcome_code,aconex_doc_status,revision')
      .eq('package_code', pkg).eq('is_awarded', true).order('id').range(off, off + 999)
    if (error) throw new Error(error.message)
    if (!data || !data.length) break
    rows.push(...(data as Row[]))
    if (data.length < 1000) break
  }
  return rows
}

async function main() {
  const apply = process.argv.includes('--apply')
  let updated = 0, skippedRES = 0, errors = 0
  for (const pkg of ['K125', 'K124']) {
    const rows = await fetchPkg(pkg)
    const dist: Record<number, number> = {}
    const patches: { id: string; percent: number; milestone: number }[] = []
    for (const r of rows) {
      if (pkg === 'K124' && isRES(r.aconex_doc_status)) { skippedRES++; continue }
      const res = pkg === 'K125'
        ? computeProgress({ hasSubmission: !!r.revision, latestOutcome: r.review_outcome_code, latestRevision: r.revision })
        : computeProgressFromStatus(r.aconex_doc_status, r.revision)
      dist[res.percent] = (dist[res.percent] ?? 0) + 1
      patches.push({ id: r.id, percent: res.percent, milestone: res.milestone })
    }
    const n = patches.length
    const mean = n ? Math.round((patches.reduce((a, p) => a + p.percent, 0) / n) * 10) / 10 : 0
    console.log(`${pkg}: ${n} docs, mean ${mean}%  dist ${JSON.stringify(dist)}`)
    if (apply) {
      for (let i = 0; i < patches.length; i += 25) {
        const part = patches.slice(i, i + 25)
        const errs = await Promise.all(part.map((p) =>
          db.from('mddr_entries').update({
            progress_percent: p.percent, progress_milestone: p.milestone, progress_source: 'rules_of_credit',
          }).eq('id', p.id).then((r) => r.error)))
        for (const e of errs) { if (e) { errors++; if (errors <= 5) console.log('  err:', e.message) } else updated++ }
      }
    }
  }
  console.log(apply ? `\nAPPLIED: updated ${updated}, RES skipped ${skippedRES}, errors ${errors}` : '\n(dry run — no writes)')
}
main().catch((e) => { console.error(e); process.exit(1) })
