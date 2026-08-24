import { createServiceClient } from '@/lib/supabase/server'
import { k124Candidates, isReady, type CarryoverRow, type CarryoverView, type K124Status } from './types'

export * from './types'

/**
 * Which existing K124 numbers are already registered, and where.
 * Checked against BOTH the CDDL and the MDDR: 38 of the 41 unregistered numbers turned out
 * to be in the MDDR already, which makes them a register-sync gap rather than lost work.
 */
export async function getK124Status(rows: CarryoverRow[]): Promise<Record<string, K124Status | null>> {
  const db = createServiceClient()
  const norm = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

  const page = async (table: string, sel: string) => {
    const out: Record<string, unknown>[] = []
    for (let off = 0; ; off += 1000) {
      const { data } = await db.from(table).select(sel).eq('package_code', 'K124').order('id').range(off, off + 999)
      if (!data?.length) break
      out.push(...(data as Record<string, unknown>[]))
      if (data.length < 1000) break
    }
    return out
  }
  const cddl = await page('cddl_doc', 'docno,retired')
  const mddr = await page('mddr_entries', 'normalized_document_number,document_number')
  const inCddl = new Set(cddl.filter((r) => !r.retired).map((r) => norm(r.docno)))
  const inMddr = new Set(mddr.flatMap((r) => [norm(r.normalized_document_number), norm(r.document_number)]).filter(Boolean))

  return Object.fromEntries(rows.map((r) => {
    const cands = k124Candidates(r)
    if (!cands.length) return [r.temp_ref, null]
    // Prefer a candidate that IS registered — if either the file name or the printed
    // number is known, the document is known.
    const hit = cands.find((c) => inCddl.has(norm(c.number)))
      ?? cands.find((c) => inMddr.has(norm(c.number)))
      ?? cands[0]
    return [r.temp_ref, { ...hit, inCddl: inCddl.has(norm(hit.number)), inMddr: inMddr.has(norm(hit.number)) }]
  }))
}

export async function getCarryover(): Promise<CarryoverView> {
  const db = createServiceClient()
  const rows: CarryoverRow[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db
      .from('cddl_carryover')
      .select('*')
      .order('temp_ref')
      .range(off, off + 999)
    if (error) throw new Error(`cddl_carryover: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as CarryoverRow[]))
    if (data.length < 1000) break
  }

  const pkg = new Map<string, { docs: number; done: number }>()
  for (const r of rows) {
    const k = r.target_package ?? '—'
    const p = pkg.get(k) ?? { docs: 0, done: 0 }
    p.docs++
    if (isReady(r)) p.done++
    pkg.set(k, p)
  }

  return {
    rows,
    total: rows.length,
    read: rows.filter((r) => r.ai_read_at && !r.ai_error).length,
    unread: rows.filter((r) => !r.ai_read_at).length,
    failed: rows.filter((r) => r.ai_error).length,
    withBorder: rows.filter((r) => r.ai_has_border === true).length,
    withoutBorder: rows.filter((r) => r.ai_has_border === false).length,
    withPrintedNumber: rows.filter((r) => !!r.ai_docno).length,
    done: rows.filter((r) => isReady(r)).length,
    packages: [...pkg.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.docs - a.docs),
    readyToPaste: rows.filter((r) => isReady(r)).length,
  }
}
