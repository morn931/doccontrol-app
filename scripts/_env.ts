// Load .env.local into process.env BEFORE any lib that reads its config at module load
// (lib/services/graph.ts captures MICROSOFT_* when imported). Import this first in a script.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('='); const k = t.slice(0, i).trim()
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
