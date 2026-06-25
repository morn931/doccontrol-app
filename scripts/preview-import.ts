/**
 * Dry-run preview of an MDDR register import. Parses a register file and reports
 * EXACTLY what would change in mddr_entries (dates / status / progress) using the
 * real importWorkbook in refresh mode — but writes NOTHING.
 *
 *   npx tsx scripts/preview-import.ts "C:\\Users\\…\\E102 SDDR (2).xlsx" E102 SDDR
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { importWorkbook } from '../lib/mddr/import'
import type { RegisterType } from '../lib/mddr/mapping'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  const k = t.slice(0, i).trim()
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  if (!(k in process.env)) process.env[k] = v
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')          // write for real; default = dry run
  const [file, pkg, type = 'SDDR'] = args.filter(a => !a.startsWith('--'))
  if (!file || !pkg) { console.error('usage: preview-import.ts <file> <PKG> [SDDR|CDDL|MDDR] [--apply]'); process.exit(1) }

  const buf = fs.readFileSync(file)
  const r = await importWorkbook(db, buf, {
    registerType: type as RegisterType, formPackage: pkg, fileName: path.basename(file),
    uploadMode: 'refresh', dryRun: !apply,
  })

  if (apply) {
    console.log(`\n=== APPLIED: ${path.basename(file)}  [${type} ${pkg}] ===`)
    console.log(`Inserted ${r.inserted}, updated ${r.updated}, errors ${r.errors.length}`)
    r.errors.slice(0, 5).forEach(e => console.log('  ·', e))
    return
  }

  console.log(`\n=== DRY RUN (no writes): ${path.basename(file)}  [${type} ${pkg}] ===`)
  console.log(`Awarded docs parsed : ${r.awarded}`)
  console.log(`Would INSERT (new)  : ${r.inserted}`)
  console.log(`Would UPDATE (exist): ${r.updated}`)

  const pv = r.preview ?? []
  const byField: Record<string, number> = {}
  let datePlusOne = 0, progChanges = 0
  for (const p of pv) for (const c of p.changes) {
    byField[c.field] = (byField[c.field] ?? 0) + 1
    if (c.field === 'planned_completion_date') {
      const a = Date.parse(String(c.from)), b = Date.parse(String(c.to))
      if (Number.isFinite(a) && Number.isFinite(b) && Math.round((b - a) / 86_400_000) === 1) datePlusOne++
    }
    if (c.field === 'progress_percent') progChanges++
  }
  console.log(`\nRows with ≥1 change : ${pv.length}`)
  console.log('Changes by field    :', byField)
  console.log(`  · planned_completion shifts of exactly +1 day (the date-bug fix): ${datePlusOne}`)
  console.log(`  · progress_percent changes: ${progChanges}`)
  console.log('\nSample (first 15 changed docs):')
  for (const p of pv.slice(0, 15)) {
    console.log(`  ${p.doc}`)
    for (const c of p.changes) console.log(`     ${c.field}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`)
  }
  if (r.errors.length) console.log('\nErrors:', r.errors.slice(0, 5))
}
main().catch(e => { console.error(e); process.exit(1) })
