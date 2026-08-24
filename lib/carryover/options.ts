// The values a document controller may choose from — taken from the CDDL they are pasting
// INTO, so a carry-over row can only ever carry codes that register already understands.
// A free-typed discipline is how a register acquires an "Elec" alongside its "E".
//
// Deriving these from cddl_doc rather than the Engineering CDDL is deliberate now that the
// register lives in CoreDocs: the destination defines what is valid.
import { createServiceClient } from '@/lib/supabase/server'

export type Option = { value: string; label: string }

/** The Engineering CDDL's own "Drop Lists" sheet — the PERMITTED values, not merely the
 *  ones in use, so an empty column cannot shrink the list.
 *  Source: 6105AK124-6200-GLST-0001 CDDL Doc Register.xlsx, sheet "Drop Lists". */
export const ACONEX_STATUS: Option[] = [
  { value: 'RES - Reserved Placeholder', label: 'RES - Reserved Placeholder' },
  { value: 'IFR - Issued for Review', label: 'IFR - Issued for Review' },
  { value: 'IFD - Issued for Design', label: 'IFD - Issued for Design' },
  { value: 'IFC - Issued for Construction', label: 'IFC - Issued for Construction' },
  { value: 'IFU - Issued for Use', label: 'IFU - Issued for Use' },
  { value: 'No Placeholder Yet', label: 'No Placeholder Yet' },
]

export const PLANT: Option[] = [
  { value: 'Plant Main Substation (Main Consumer)', label: 'Plant Main Substation (Main Consumer)' },
  { value: 'Power Station Substation (Main Intake)', label: 'Power Station Substation (Main Intake)' },
  { value: 'PV Plant Substation', label: 'PV Plant Substation' },
  { value: 'Mining Substation', label: 'Mining Substation' },
]

const DISCIPLINE: Record<string, string> = {
  E: 'Electrical', C: 'Civil', I: 'Instrumentation', M: 'Mechanical', F: 'Process & Control',
  W: 'Civil — earthworks', S: 'Structural', T: 'Telecoms', G: 'General', A: 'Architectural',
  H: 'HSE', Q: 'Quality', P: 'Piping', B: 'Project Controls', J: 'Environmental', U: 'Utilities',
}

export type CarryoverOptions = {
  discipline: Option[]
  docType: Option[]
  wbs: Option[]
  broadType: Option[]
  aconexStatus: Option[]
  plant: Option[]
}

export async function getCarryoverOptions(): Promise<CarryoverOptions> {
  const db = createServiceClient()
  const rows: Record<string, unknown>[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('cddl_doc')
      .select('discipline,doc_type,wbs,broad_type,retired')
      .eq('package_code', 'K124').order('docno').range(off, off + 999)
    if (!data?.length) break
    rows.push(...(data as Record<string, unknown>[]))
    if (data.length < 1000) break
  }
  const live = rows.filter((r) => !r.retired)
  const count = (key: string) => {
    const m = new Map<string, number>()
    for (const r of live) {
      const v = String(r[key] ?? '').trim()
      if (v) m.set(v, (m.get(v) ?? 0) + 1)
    }
    return m
  }
  const disc = count('discipline'), types = count('doc_type'), wbs = count('wbs'), broad = count('broad_type')

  return {
    // Every discipline the project recognises, those in use first.
    discipline: Object.entries(DISCIPLINE)
      .map(([code, name]) => ({ value: code, label: `${code} — ${name}`, n: disc.get(code) ?? 0 }))
      .sort((a, b) => (b.n ? 1 : 0) - (a.n ? 1 : 0) || a.value.localeCompare(b.value))
      .map(({ value, label }) => ({ value, label })),
    docType: [...types.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, label: `${v}  (${n})` })),
    wbs: [...wbs.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, label: `${v}  (${n} docs)` })),
    broadType: [...broad.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => ({ value: v, label: v })),
    aconexStatus: ACONEX_STATUS,
    plant: PLANT,
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Translate what the reader wrote into the code the CDDL stores — it writes "Electrical"
 * where the register wants "E". Returns inList:false when it cannot be mapped, so the
 * caller can show the raw value and say it is off-list rather than force it into the
 * nearest slot: the reader returns "Issued for Tender", which is not one of the six
 * permitted statuses, and a controller needs to see that.
 */
export function codeForReaderValue(
  field: 'discipline' | 'doc_type' | 'aconex_doc_status',
  raw: string | null | undefined,
  opts: CarryoverOptions,
): { value: string; inList: boolean } | null {
  const v = (raw ?? '').trim()
  if (!v) return null

  if (field === 'discipline') {
    if (v.length <= 2 && opts.discipline.some((o) => o.value === v.toUpperCase())) return { value: v.toUpperCase(), inList: true }
    const hit = Object.entries(DISCIPLINE).find(([, name]) => norm(name) === norm(v))
    return hit ? { value: hit[0], inList: true } : { value: v, inList: false }
  }

  if (field === 'doc_type') {
    const up = v.toUpperCase()
    if (opts.docType.some((o) => o.value === up)) return { value: up, inList: true }
    return { value: v, inList: false }
  }

  const up = v.toUpperCase()
  const exact = opts.aconexStatus.find((o) => o.value.toUpperCase() === up)
  if (exact) return { value: exact.value, inList: true }
  if (/^IF[CURDI]/.test(up)) {
    const byCode = opts.aconexStatus.find((o) => up.startsWith(o.value.slice(0, 3).toUpperCase()))
    if (byCode) return { value: byCode.value, inList: true }
  }
  const byWords = opts.aconexStatus.find((o) => norm(o.value).includes(norm(v)))
  return byWords ? { value: byWords.value, inList: true } : { value: v, inList: false }
}
