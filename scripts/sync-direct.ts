/**
 * Direct progress sync — carries live review status into the MDDR master and
 * applies the Rules of Credit, writing straight to Supabase with the service key
 * (bypasses the auth-protected HTTP route). Reuses lib/mddr/sync.
 *
 *   npx tsx scripts/sync-direct.ts            # all packages
 *   npx tsx scripts/sync-direct.ts K137       # one package
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { syncProgress } from '../lib/mddr/sync'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  if (!(t.slice(0, i).trim() in process.env)) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

syncProgress(db, { packageCode: process.argv[2] })
  .then(r => {
    console.log(`Synced: ${r.matched} matched live docs, ${r.updated} updated. Live versions indexed: ${r.liveVersionsIndexed}.`)
    r.errors.forEach(e => console.log('  · ' + e))
  })
  .catch(e => { console.error(e); process.exit(1) })
