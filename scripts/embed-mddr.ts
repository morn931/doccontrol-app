/**
 * Backfill MDDR embeddings for semantic search.
 *
 * Prereqs: migration 005 applied; Azure embeddings model deployed and
 * AZURE_OPENAI_EMBEDDING_DEPLOYMENT set in .env.local. Run Sync Progress first
 * so ai_text is populated on matched rows.
 *
 *   npx tsx scripts/embed-mddr.ts          # embed awarded rows missing an embedding
 *   npx tsx scripts/embed-mddr.ts --all    # re-embed all awarded rows
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { embed, buildEmbedText } from '../lib/services/embeddings'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('='); if (!(t.slice(0, i).trim() in process.env)) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const db: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const ALL = process.argv.includes('--all')
const SELECT = 'id, document_number, document_title, discipline, document_type, package_code, ai_text'

async function main() {
  // Load awarded rows (optionally only those missing an embedding).
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = db.from('mddr_entries').select(SELECT).eq('is_active', true).eq('is_awarded', true)
      .order('id', { ascending: true }).range(from, from + 999)
    if (!ALL) q = q.is('embedding', null)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  console.log(`Embedding ${rows.length} document(s)${ALL ? ' (all)' : ' (missing only)'}…`)

  const BATCH = 96
  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const vectors = await embed(chunk.map(buildEmbedText))
    const updates = chunk.map((r, j) => ({
      id: r.id, embedding: `[${vectors[j].join(',')}]`, embedded_at: new Date().toISOString(),
    }))
    const { error } = await db.from('mddr_entries').upsert(updates, { onConflict: 'id' })
    if (error) { console.error('  upsert error:', error.message); continue }
    done += chunk.length
    process.stdout.write(`\r  ${done}/${rows.length}`)
  }
  console.log(`\nDone — embedded ${done} documents.`)
}
main().catch(e => { console.error(e); process.exit(1) })
