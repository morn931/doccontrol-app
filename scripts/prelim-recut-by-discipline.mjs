// Re-cut the K480 prelim sessions by DISCIPLINE (Vossie, 7 Sep 2026): the four substation
// sessions become one session per discipline across all substations, plus an empty
// "Common layouts — whole team" session for the drawings every discipline must see together,
// and a "Training" session with three drawings for the walkthrough. Every pulled drawing
// moves to its discipline's session (by its COLAB folder, else its CDDL letter); quality
// results move with it. Nothing has been marked up, so nothing is lost. Needs migration 053.
//
//   node scripts/prelim-recut-by-discipline.mjs           dry run
//   node scripts/prelim-recut-by-discipline.mjs --write
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const { DISCIPLINES, disciplineOf } = await import('../lib/prelim-disciplines.ts')
const WRITE = process.argv.includes('--write')
const BY = 'mornec@ppetech.co.za'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: old } = await sb.from('prelim_session').select('id, title, source_site_url, source_library, source_folder').ilike('title', '%tender drawings (Colab list, Sep 2026)%')
const { data: docs } = await sb.from('prelim_document').select('id, session_id, document_number, discipline, source_file_url, source_file_name, working_file_url, working_file_name, title, revision, document_type, cddl_doc_id, quality_open, pulled_by_email').in('session_id', (old ?? []).map(s => s.id))
console.log(`substation sessions: ${old?.length} · drawings in them: ${docs?.length}`)
const site = old?.[0]?.source_site_url, lib = old?.[0]?.source_library
const REG = (old?.[0]?.source_folder ?? '').split('/').slice(0, 2).join('/')   // PLANT WIDE…/Document Register

const groups = new Map()
for (const d of docs ?? []) { const k = disciplineOf(d.source_file_url, d.discipline) ?? 'Other'; (groups.get(k) ?? groups.set(k, []).get(k)).push(d) }
console.log('by discipline:', [...groups.entries()].map(([k, v]) => `${k} ${v.length}`).join(' · '))

const PLAN = [
  ...DISCIPLINES.map(d => ({ title: `${d.key} — tender drawings (all substations)`, disciplines: [d.key], key: d.key, notes: `Discipline session per Vossie, 7 Sep 2026. Pull the ${d.key} folder of each substation.` })),
  { title: 'Common layouts — whole team', disciplines: DISCIPLINES.map(d => d.key), key: null, notes: 'Site layouts, single lines and anything two disciplines must agree on. Every discipline in the room.' },
  { title: 'Training — try the tool here', disciplines: [], key: 'TRAINING', notes: 'Three drawings for the walkthrough. Draw, save, record a call, hand one over — none of it counts. Delete the session after training.' },
]
for (const p of PLAN) console.log(`  session "${p.title}" ← ${p.key && p.key !== 'TRAINING' ? (groups.get(p.key)?.length ?? 0) + ' drawings' : p.key === 'TRAINING' ? '3 drawings (copies)' : 'empty'}`)
const other = groups.get('Other') ?? []; if (other.length) console.log(`⚠ ${other.length} drawings match no discipline (stay in place):`, other.map(d => d.source_file_name).join(', '))
if (!WRITE) { console.log('\n(dry run — pass --write to apply)'); process.exit(0) }

const made = new Map()
for (const p of PLAN) {
  const { data: exists } = await sb.from('prelim_session').select('id').eq('title', p.title).maybeSingle()
  if (exists) { made.set(p.title, exists.id); continue }
  const { data, error } = await sb.from('prelim_session').insert({ title: p.title, area: p.key === 'TRAINING' ? 'Training' : 'All substations', source_site_url: site, source_library: lib, source_folder: REG, disciplines: p.disciplines, notes: p.notes, created_by_email: BY, created_by_name: 'Morné Cronjé' }).select('id').single()
  if (error) throw error
  made.set(p.title, data.id)
}
let moved = 0
for (const p of PLAN) {
  if (!p.key || p.key === 'TRAINING') continue
  const rows = groups.get(p.key) ?? []
  for (const d of rows) { const { error } = await sb.from('prelim_document').update({ session_id: made.get(p.title) }).eq('id', d.id); if (error) throw error; moved++ }
}
// training copies: three small drawings, as NEW rows in the training session (same source, its own working copy reference)
const trainId = made.get('Training — try the tool here')
const sample = (docs ?? []).filter(d => /\.pdf$/i.test(d.working_file_name)).slice(0, 3)
for (const d of sample) {
  const { data: exists } = await sb.from('prelim_document').select('id').eq('session_id', trainId).eq('source_file_url', d.source_file_url).maybeSingle()
  if (exists) continue
  const { error } = await sb.from('prelim_document').insert({ session_id: trainId, cddl_doc_id: d.cddl_doc_id, document_number: d.document_number, revision: d.revision, title: `${d.title} (TRAINING COPY)`, discipline: d.discipline, document_type: d.document_type, source_file_name: d.source_file_name, source_file_url: d.source_file_url, working_file_name: d.working_file_name, working_file_url: d.working_file_url, pulled_by_email: BY })
  if (error) throw error
}
// the emptied substation sessions go
let removed = 0
for (const s of old ?? []) { const { count } = await sb.from('prelim_document').select('id', { count: 'exact', head: true }).eq('session_id', s.id); if ((count ?? 0) === 0) { await sb.from('prelim_session').delete().eq('id', s.id); removed++ } }
console.log(`\nmoved ${moved} drawings · training copies ${sample.length} · removed ${removed} empty substation sessions`)
for (const [t, id] of made) console.log(`   ${id}  ${t}`)
