/**
 * Direct bulk import of all Registers/*.xlsx into the MDDR — writes straight to
 * Supabase with the service-role key (bypasses the auth-protected HTTP route),
 * reusing the exact same parsing/merge logic via lib/mddr/import.
 *
 * Prereq: migration 004 applied. Run:
 *   npx tsx scripts/import-direct.ts
 *
 * Order: vendor SDDRs + CDDL first (accurate dates/status own their fields), then
 * the master GMDR/MDDR last (fills gaps: activity IDs, equipment, scope rows).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { importWorkbook } from '../lib/mddr/import'
import type { RegisterType } from '../lib/mddr/mapping'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── Load .env.local ──────────────────────────────────────────
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  const k = t.slice(0, i).trim()
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  if (!(k in process.env)) process.env[k] = v
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })

function detect(fileName: string): { registerType: RegisterType; pkg: string } {
  const u = fileName.toUpperCase()
  let registerType: RegisterType = 'SDDR'
  if (u.includes('CDDL') || u.includes('CDDR')) registerType = 'CDDL'
  else if (u.includes('GMDR') || u.includes('MDDR')) registerType = 'MDDR'
  let pkg = ''
  if (registerType !== 'MDDR') {
    const m = u.match(/\b(K\d{3}[A-Z]?|E\d{3}[A-Z]?|X\d{3}[A-Z]?)\b/)
    if (m) pkg = m[1]
  }
  return { registerType, pkg }
}

async function main() {
  const filter = process.argv[2]   // optional: only import files whose name includes this
  const dir = path.join(ROOT, 'Registers')
  const files = fs.readdirSync(dir)
    .filter(f => /\.(xlsx|xls)$/i.test(f) && !f.startsWith('~$'))
    .filter(f => !filter || f.toUpperCase().includes(filter.toUpperCase()))
    .sort((a, b) => (detect(a).registerType === 'MDDR' ? 1 : 0) - (detect(b).registerType === 'MDDR' ? 1 : 0))

  console.log(`Importing ${files.length} register file(s) → ${url}\n`)
  let totIns = 0, totUpd = 0

  for (const fileName of files) {
    const { registerType, pkg } = detect(fileName)
    process.stdout.write(`→ ${fileName}  [${registerType}${pkg ? ' ' + pkg : ''}] … `)
    try {
      const buf = fs.readFileSync(path.join(dir, fileName))
      const r = await importWorkbook(db, buf, { registerType, formPackage: pkg, fileName })
      console.log(`inserted ${r.inserted}, updated ${r.updated}, awarded ${r.awarded}, scope ${r.placeholders}` +
        (r.errors.length ? `, ${r.errors.length} row-errors` : ''))
      r.errors.slice(0, 3).forEach(e => console.log(`    · ${e}`))
      totIns += r.inserted; totUpd += r.updated
    } catch (e: any) {
      console.log(`FAILED: ${e.message}`)
    }
  }

  console.log(`\n═══ Done — ${totIns} inserted, ${totUpd} updated ═══`)
}

main().catch(e => { console.error(e); process.exit(1) })
