// Probe: run resolveLead() over every distinct doc_owner on the live CDDL and print what
// each resolves to — resolved (1), prompt with candidates (>1), prompt with none (0).
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const { resolveLead } = await import('../lib/prelim/lead.ts')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: users } = await sb.from('users').select('email, full_name, role, active').limit(1000)
const people = users.filter(u => u.active !== false && u.email).map(u => ({ email: u.email.toLowerCase(), name: u.full_name ?? u.email, role: u.role ?? '' }))
const { data: all } = await sb.from('cddl_doc').select('doc_owner').limit(50000)
const dist = new Map()
for (const r of all) dist.set(r.doc_owner ?? '', (dist.get(r.doc_owner ?? '') ?? 0) + 1)
let ok = 0, prompt = 0, none = 0
for (const [owner, n] of [...dist].sort((a, b) => b[1] - a[1])) {
  const { resolved, candidates: c } = resolveLead(owner, people)
  const tag = resolved ? 'RESOLVED' : c.length ? 'PROMPT  ' : 'NONE    '
  if (resolved) ok += n; else if (c.length) prompt += n; else none += n
  console.log(`${tag} ${String(n).padStart(5)}  ${owner.padEnd(58)} → ${c.map(p => `${p.name} <${p.email}>`).join(' | ') || '(no candidate)'}`)
}
console.log(`\nrows: resolved ${ok} · prompt with candidates ${prompt} · prompt with none ${none}`)
