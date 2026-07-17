/**
 * Nightly MDDR refresh from the mirrored CDDL + SDDR workbooks.
 *
 * The 06:00 scan (costflow-app: cddl_sync.py + sddr_sync.py) downloads every
 * register workbook to %TEMP%. This script feeds those same files through the
 * standard import pipeline (lib/mddr/import) in 'refresh' mode, so the MDDR
 * stays reconciled with the live registers without manual re-uploads:
 *   - dates (Due Date -> planned completion, IFR/Rev A -> actual submission,
 *     IFC-IFU/Rev 0 -> actual completion) + progress % take the register's value;
 *   - everything else keeps the fill-blanks merge (no clobbering enrichment);
 *   - new documents insert; nothing is deleted.
 *
 * K038 (Early Works) is deliberately NOT fed in — it does not belong in the MDDR.
 *
 * Files older than MAX_AGE_H are skipped (e.g. CDDL in coreflow-master mode no
 * longer downloads a workbook — the MDDR then just keeps its last state).
 *
 * Run:  npx tsx scripts/refresh-registers.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { importWorkbook } from '../lib/mddr/import'
import type { RegisterType } from '../lib/mddr/mapping'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TMP = process.env.TEMP ?? os.tmpdir()
const MAX_AGE_H = 48

for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  const k = t.slice(0, i).trim()
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '')
  if (!(k in process.env)) process.env[k] = v
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })

const SOURCES: Array<{ file: string; registerType: RegisterType; pkg: string; vendor: string | null }> = [
  { file: 'cddl_register_K124.xlsx', registerType: 'CDDL', pkg: 'K124',  vendor: 'PPE - Technologies' },
  { file: 'sddr_sync_E102.xlsx',     registerType: 'SDDR', pkg: 'E102',  vendor: 'ABB - Synchronous Condensers' },
  { file: 'sddr_sync_E511B.xlsx',    registerType: 'SDDR', pkg: 'E511B', vendor: 'ABB - Transformers' },
  { file: 'sddr_sync_E516B.xlsx',    registerType: 'SDDR', pkg: 'E516B', vendor: 'ABB - E Houses' },
  { file: 'sddr_sync_K125.xlsx',     registerType: 'SDDR', pkg: 'K125',  vendor: 'Siemens' },
  { file: 'sddr_sync_K137.xlsx',     registerType: 'SDDR', pkg: 'K137',  vendor: 'PSI' },
  { file: 'sddr_sync_E123.xlsx',     registerType: 'SDDR', pkg: 'E123',  vendor: 'Crestchic' },
  { file: 'sddr_sync_E113.xlsx',     registerType: 'SDDR', pkg: 'E113',  vendor: 'Fuelco' },
]

async function main() {
  for (const s of SOURCES) {
    const p = path.join(TMP, s.file)
    if (!fs.existsSync(p)) { console.log(`- ${s.pkg}: ${s.file} not found — skipped`); continue }
    const ageH = (Date.now() - fs.statSync(p).mtimeMs) / 3_600_000
    if (ageH > MAX_AGE_H) {
      console.log(`- ${s.pkg}: ${s.file} is ${ageH.toFixed(0)}h old (> ${MAX_AGE_H}h) — skipped`)
      continue
    }
    try {
      // Feed ONLY the register sheet's rows that carry a document number. The
      // side sheets (Tracker, WBS codes…) AND the ~1,000 pre-formatted empty
      // template rows below the data would otherwise flood mddr_entries with
      // junk placeholders, because a set formVendor bypasses the skip-guard.
      const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true })
      const sheetName = wb.SheetNames.find(n => /^(register|cddl)$/i.test(n.trim()))
      if (!sheetName) { console.log(`- ${s.pkg}: no Register/CDDL sheet — skipped`); continue }
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
        header: 1, raw: true, defval: null, blankrows: false,
      })
      const hdrIdx = aoa.findIndex(r => (r ?? []).some(v =>
        typeof v === 'string' && /(rdmc )?document number/i.test(v.trim())))
      if (hdrIdx < 0) { console.log(`- ${s.pkg}: no Document Number header — skipped`); continue }
      const docCol = (aoa[hdrIdx] as unknown[]).findIndex(v =>
        typeof v === 'string' && /(rdmc )?document number/i.test(v.trim()))
      const dataRows = aoa.slice(hdrIdx + 1).filter(r => {
        const d = r?.[docCol]
        return d != null && String(d).replace(/-/g, '').trim() !== ''
      })
      const single = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(single,
        XLSX.utils.aoa_to_sheet([aoa[hdrIdx] as unknown[], ...dataRows], { cellDates: true }), sheetName)
      const buf = XLSX.write(single, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer

      const res = await importWorkbook(db, buf, {
        registerType: s.registerType,
        formPackage: s.pkg,
        formVendor: s.vendor,
        uploadMode: 'refresh',
        fileName: `${s.file} (nightly register refresh)`,
      })
      console.log(
        `✓ ${s.pkg} (${s.registerType}): ${res.awarded} docs — ${res.inserted} inserted, ` +
        `${res.updated} updated, ${res.placeholders} placeholders, ${res.skipped} skipped` +
        `${res.errors.length ? ` | errors: ${res.errors.join('; ')}` : ''}`,
      )
      if (res.placeholders > 0)
        console.log(`  ⚠ ${s.pkg}: ${res.placeholders} placeholder rows — register sheet has non-doc rows, check the workbook`)
    } catch (e) {
      console.log(`✗ ${s.pkg} failed: ${e instanceof Error ? e.message : e}`)
    }
  }
}
main()
