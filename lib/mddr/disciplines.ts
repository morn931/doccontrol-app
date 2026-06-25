// Discipline code → display name.
// Per the project legend: use the "Revision Class" table first; where the Revision Class
// does not list a code, fall back to the "Discipline Codes" table. Keyed by UPPERCASE so the
// inconsistently-stored raw values (e.g. "E" / "ELECTRICAL" / "Electrical") all resolve to one
// canonical name and collapse into a single filter option.

const NAMES: Record<string, string> = {
  // ── Revision Class (authoritative / primary) ──────────────────────────────
  A:  'Automation',
  B:  'Project Controls',
  C:  'Civils',
  D:  'Vendor Data',
  E:  'Electrical',
  EL: 'Earthing / Lightning',
  G:  'General',
  I:  'Instrument',
  J:  'Environmental / Social Impact',
  M:  'Mechanical',
  MP: 'Plate Work',
  P:  'Piping',
  S:  'Structural (Building)',
  SC: 'Conveyor Structures',

  // ── Discipline Codes (fallback — codes the Revision Class doesn't list) ────
  F: 'Process',
  H: 'Health & Safety / Security',
  N: 'Mining',
  Q: 'Quality & Control / HAZOP / HAZID / Risk',
  T: 'Geotechnical',
  W: 'Earthworks / Drainage / Fencing / Roads / Water',

  // ── Full-word raw values found in the data → fold to the same canonical ───
  AUTOMATION: 'Automation',
  CIVIL: 'Civils', CIVILS: 'Civils',
  ELECTRICAL: 'Electrical',
  INSTRUMENT: 'Instrument', INSTRUMENTATION: 'Instrument',
  MECHANICAL: 'Mechanical',
}

// Raw discipline value → human name (unknown values shown as-is).
export function disciplineName(raw: string | null | undefined): string {
  if (!raw) return ''
  const v = String(raw).trim()
  return NAMES[v.toUpperCase()] ?? v
}

// Group the distinct raw discipline values into normalised filter options:
// one entry per display name, carrying every raw value that maps to it.
export function groupDisciplines(raws: string[]): { label: string; raws: string[] }[] {
  const m = new Map<string, string[]>()
  for (const r of raws) {
    const label = disciplineName(r)
    if (!label) continue
    if (!m.has(label)) m.set(label, [])
    m.get(label)!.push(r)
  }
  return [...m.entries()]
    .map(([label, vals]) => ({ label, raws: vals }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
