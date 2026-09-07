// Who is the PPE responsible person for a drawing? Pure — no Next/Supabase imports — so
// scripts/_prelim-lead-probe.mjs can run it against the live register.
export type Person = { email: string; name: string; role: string }

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
const PARTICLES = new Set(['van', 'de', 'der', 'le', 'du'])
const initialsOf = (name: string) => strip(name).split(' ').filter(w => !PARTICLES.has(w)).map(w => w[0]).join('')

/**
 * Resolve the CDDL's `doc_owner` ("Flippie van Vuuren (FV)", "Johan Marnewick or Jarrod
 * McAllister (JM)", or bare initials "DK") to CoreDocs users. Measured against the live
 * register on 2026-09-07 (28 distinct owner strings, 44 users).
 *
 *   resolved   — ONE name in the owner field and exactly one user fits it. The mail goes.
 *   candidates — everything else: an "A or B" owner (even when only one has an account —
 *                the register itself says it is not decided), bare initials, or a name
 *                that fits nobody. The reviewer picks; nothing is guessed.
 *
 * A name fits a user by full_name ("Arno Smit"), by the email local part being first name
 * + an initial of the surname or its particle ("Tanya De Klerk" → tanyad, "Roelien van
 * Staden" → roelienv), or by a user whose full_name is just the first name or first name +
 * that initial ("Vossie", "Flippiev", "Reinette S").
 */
export function resolveLead(docOwner: string | null | undefined, people: Person[]): { resolved: Person | null; candidates: Person[] } {
  const raw = String(docOwner ?? '').trim()
  if (!raw) return { resolved: null, candidates: [] }
  const names = raw.replace(/\([^)]*\)\s*$/, '').split(/\s*(?:,|\bor\b|\/|&)\s*/i).map(strip).filter(Boolean)
  const found = new Map<string, Person>()
  let initialsOnly = false
  for (const n of names) {
    const words = n.split(' ')
    if (words.length === 1 && n.length <= 4) {
      initialsOnly = true
      for (const p of people) if (initialsOf(p.name) === n) found.set(p.email, p)
      continue
    }
    const first = words[0]
    const initials = new Set([words[1]?.[0], words[words.length - 1]?.[0]].filter(Boolean) as string[])
    for (const p of people) {
      const pn = strip(p.name), local = p.email.split('@')[0].toLowerCase()
      const hit = pn === n || pn === first
        || [...initials].some(i => local === first + i || pn === first + i || pn === `${first} ${i}`)
      if (hit) found.set(p.email, p)
    }
  }
  const candidates = [...found.values()]
  const resolved = names.length === 1 && !initialsOnly && candidates.length === 1 ? candidates[0] : null
  return { resolved, candidates }
}
