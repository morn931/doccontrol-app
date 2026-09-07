/**
 * Prelim Review — the disciplines a session can be cut by. Client-safe (no server imports)
 * because the session form renders the list; lib/prelim.ts re-exports it for the server.
 *
 * Matches the COLAB folder names ("Electrical - Main Consumer Substation") and the CDDL
 * discipline letter, so a drawing lands in the right discipline whichever it carries.
 */
export const DISCIPLINES = [
  { key: 'Electrical',                    letters: ['E'],                      folder: /electrical/i },
  { key: 'Civil & Structural',            letters: ['C', 'S', 'W'],            folder: /civil|structural/i },
  { key: 'Instrumentation & Automation',  letters: ['I', 'A', 'F', 'T', 'U'],  folder: /instrument|automation|control/i },
  { key: 'Mechanical',                    letters: ['M', 'P'],                 folder: /mechanical|piping/i },
  { key: 'Fire & Environmental',          letters: ['H', 'J'],                 folder: /fire|environment/i },
  { key: 'BOQ & Cable Schedule',          letters: ['G', 'B'],                 folder: /boq|bill of quant|cable schedule/i },
] as const
export type DisciplineKey = typeof DISCIPLINES[number]['key']

/** Which discipline a drawing belongs to: its COLAB folder first, the CDDL letter second. */
export function disciplineOf(sourceFileUrl: string | null | undefined, cddlLetter: string | null | undefined): DisciplineKey | null {
  let path = String(sourceFileUrl ?? '')
  try { path = decodeURIComponent(path) } catch { /* leave as is */ }
  for (const d of DISCIPLINES) if (d.folder.test(path)) return d.key
  const L = String(cddlLetter ?? '').trim().toUpperCase().slice(0, 1)
  for (const d of DISCIPLINES) if ((d.letters as readonly string[]).includes(L)) return d.key
  return null
}
