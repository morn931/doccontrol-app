/**
 * Aconex Review Tracker sync — the server-side replacement for
 * costflow-app/scripts/aconex_review_sync.py (which only ran when Morné's laptop
 * was on at 06:00; last local run 2026-09-05).
 *
 * Pulls the Aconex document register for each tracked package via CoreCost's
 * secret-gated /api/aconex/register (CoreCost holds the Aconex OAuth integration;
 * CoreDocs holds no Aconex key), derives WHOSE COURT each document is in, enriches
 * from Document Control's CDDL workbook (Doc Owner / due / % complete) and upserts
 * into `aconex_review_doc`, then records the run in `aconex_review_sync`.
 *
 * INCREMENTAL BY DESIGN. The bulk register search returns docno / revision /
 * modified date but NOT the review fields, which cost one metadata call per
 * document (~10,500 across K124 + K038 — far past a 300s function). So each run:
 *   1. lists the whole register cheaply (100 docs per call),
 *   2. fetches metadata only for NEW documents and documents whose modified date
 *      or revision moved since the row was last written,
 *   3. spends whatever budget is left re-reading the STALEST rows, so the entire
 *      register is re-read over a few nights even where Aconex leaves the modified
 *      date alone (a review outcome does not always bump it).
 * Every step draws from ONE deadline and the run stops early rather than being
 * killed, so it always writes a sync row that says what it did.
 */
import * as XLSX from 'xlsx'
import { getSiteId, getLibraryDriveId, graphFetch } from '@/lib/services/graph'

export const RDMC_PROJECT_ID = '671090258'
export const TRACKED_PACKAGES = ['K124', 'K038'] as const

// ── CoreCost register proxy ───────────────────────────────────────────────────
function corecost() {
  const base = (process.env.CORECOST_URL || 'https://costflow-app.vercel.app').replace(/\/+$/, '')
  const secret = process.env.ACONEX_SEARCH_SECRET
  if (!secret) throw new Error('ACONEX_SEARCH_SECRET is not configured')
  return { base, secret }
}

async function ccGet<T>(qs: string): Promise<T> {
  const { base, secret } = corecost()
  let last: Response | null = null
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${base}/api/aconex/register?${qs}`, {
      headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store',
    })
    last = res
    if (res.ok) return (await res.json()) as T
    if (res.status < 500 && res.status !== 429) break
    await new Promise(r => setTimeout(r, 500 * (i + 1)))
  }
  const body = last ? (await last.text()).slice(0, 200) : ''
  throw new Error(`CoreCost register ${qs.split('&')[0]} -> HTTP ${last?.status} ${body}`)
}

type ListDoc = { docId: string; docno: string; revision: string; dateModified: string }
type ListPage = { ok: boolean; total: number; totalPages: number; page: number; docs: ListDoc[] }
type Meta = {
  docId: string; ok: boolean; docno: string; title: string; docType: string; discipline: string
  packageNo: string; revision: string; authorOrg: string; docStatus: string; reviewStatus: string
  reviewSource: string; dateModified: string
}

// ── whose-court derivation (ported 1:1 from aconex_review_sync.py) ───────────
const CLOSED = new Set(['approved', 'acknowledged (information only)', 'accepted', 'closed'])
const PPE_BALL = new Set(['rejected - revise & resubmit', 'reviewed with comments', 'reviewed'])

export function deriveCourt(reviewStatus: string, ageDays: number | null, docStatus: string): [string, string, string] {
  const r = (reviewStatus || '').toLowerCase().replace(/&amp;/g, '&').trim()
  const ds = (docStatus || '').trim()
  if (CLOSED.has(r)) return ['CLOSED', 'Closed', `Review status '${reviewStatus}' — no action outstanding.`]
  if (r === 'terminated') return ['CLOSED', 'Terminated', 'Superseded / cancelled revision.']
  if (PPE_BALL.has(r)) return ['PPE', 'PPE — our action', `RDMC has responded (${reviewStatus}) — PPE to action / resubmit.`]
  if (['pending', 'none', '', 'in review', 'under review'].includes(r)) {
    // Document Control's 2026-07-16 review proved "Pending" is two very different
    // courts. The API's DocumentStatus is the discriminator: RES = reserved
    // placeholder — never issued, sits with the PPE document owner; anything issued
    // (IFR/IFI/IFC/IFU/IFD…) = genuinely in review.
    if (ds.toUpperCase().startsWith('RES') || !ds) {
      return ['NOT_TRANSMITTED', 'Not yet submitted — with PPE doc owner',
        `Aconex doc status '${ds || 'blank'}' — reserved placeholder, no revision issued yet. ` +
        'The deliverable sits with the PPE document owner (see CDDL).']
    }
    let note = `Issued (${ds}); RDMC review outcome not yet returned.`
    if (ageDays && ageDays > 180) note += ` ⚠ ${ageDays}d since last movement — worth confirming with Doc Control.`
    return ['RDMC', 'Awaiting RDMC review', note]
  }
  return ['UNKNOWN', reviewStatus || 'Unknown', 'Unrecognised review status.']
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

function sameInstant(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  const ta = Date.parse(a), tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a.trim() === b.trim()
  return Math.abs(ta - tb) < 1000
}

// ── CDDL enrichment (Doc Owner / due / % complete) ────────────────────────────
// Doc-owner initials → full names (matched against company_members, 2026-07-16).
// Ambiguous initials show ALL candidates so Document Control can rule on them.
const OWNER_NAMES: Record<string, string> = {
  VV: 'Vossie Vorster', MC: 'Morne Cronje', FV: 'Flippie van Vuuren', IS: 'Ian Steynberg',
  YB: 'Yolandi Bezuidenhout', CLR: 'Christo Le Roux', TDK: 'Tanya De Klerk', LC: 'Liezl Cronje',
  LG: 'Luthando Gwina', QV: 'Quinton Visagie', JV: 'Johan Vorster', OC: 'Omari Chingovo',
  AS: 'Arno Smit', ET: 'Eric Thwala', TV: 'Tommie Veldman', TM: 'Thembelihle Mgoqi',
  RP: 'Riaan Pretorius', NL: 'Nico Lubbe', FO: 'Ferdi Oelofse', EB: 'Elsa Bothma', PN: 'Paul Nsangi',
}
const OWNER_CANDIDATES: Record<string, string> = {
  JM: 'Johan Marnewick or Jarrod McAllister', JC: 'Jaco Cornelius or Jorge Cordeiro',
  RS: 'Reinette Schultz or Roelien van Staden', MM: 'Marnus Meyer or Mitch McAllister',
  LS: 'Leann Spasimante, Louis Smit or Lucky Sibitane',
}
function ownerDisplay(initials: string): string | null {
  if (!initials) return null
  const key = initials.toUpperCase()
  const name = OWNER_NAMES[key] ?? OWNER_CANDIDATES[key]
  return name ? `${name} (${initials})` : initials
}

// Per-package CDDL workbook in the DocumentControl site's "CDDL" library.
// Early Works has no "% Complete" column (pct stays null on the tracker).
const CDDL_CFG: Record<string, { search: string; nameMatch: string; pct: string | null }> = {
  K124: { search: 'GDDR', nameMatch: 'Phase1 CDDL', pct: '% Complete' },
  K038: { search: 'Early Works', nameMatch: 'Early Works CDDL', pct: null },
}

type CddlRow = { doc_owner: string | null; cddl_due: string | null; cddl_pct: number | null }

async function loadCddl(pkg: string): Promise<Map<string, CddlRow>> {
  const cfg = CDDL_CFG[pkg]
  if (!cfg) return new Map()
  const siteUrl = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL || 'https://ppetechcoza.sharepoint.com/sites/DocumentControl'
  const siteId = await getSiteId(siteUrl)
  const driveId = await getLibraryDriveId(siteId, 'CDDL')
  const sRes = await graphFetch(`/drives/${driveId}/root/search(q='${encodeURIComponent(cfg.search)}')?$top=10`)
  if (!sRes.ok) throw new Error(`CDDL search failed: ${await sRes.text()}`)
  const hits = ((await sRes.json()).value ?? []) as { id: string; name: string }[]
  const item = hits.find(h => h.name.includes(cfg.nameMatch))
  if (!item) throw new Error(`CDDL workbook not found for ${pkg} (looked for "${cfg.nameMatch}")`)
  const cRes = await graphFetch(`/drives/${driveId}/items/${item.id}/content`)
  if (!cRes.ok) throw new Error(`CDDL download failed: HTTP ${cRes.status}`)
  const wb = XLSX.read(Buffer.from(await cRes.arrayBuffer()), { type: 'buffer', cellDates: true })
  const ws = wb.Sheets['CDDL']
  if (!ws) throw new Error('CDDL workbook has no "CDDL" sheet')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  const out = new Map<string, CddlRow>()
  for (const row of rows) {
    const dn = row['RDMC Document Number']
    if (!dn) continue
    const dueRaw = row['Due Date']
    const due = dueRaw instanceof Date ? dueRaw.toISOString().slice(0, 10) : (dueRaw ? String(dueRaw).trim() : null)
    let pct: number | null = null
    if (cfg.pct && cfg.pct in row) {
      const v = row[cfg.pct]
      const n = v == null || String(v).trim() === '' ? NaN : Number(v)
      pct = Number.isFinite(n) ? n : null
    }
    const owner = ownerDisplay(String(row['Doc Owner'] ?? '').trim())
    out.set(String(dn).trim().toUpperCase(), { doc_owner: owner, cddl_due: due, cddl_pct: pct })
  }
  return out
}

// ── the sync ─────────────────────────────────────────────────────────────────
export type PackageResult = {
  package: string
  listed: number            // documents the register search returned
  inPackage: number         // rows now held for this package
  newDocs: number
  changed: number
  staleRefreshed: number
  refreshed: number         // metadata rows written (new + changed + stale)
  notInPackage: number      // search over-matches dropped after metadata
  missingFromAconex: number // rows we hold that the search no longer lists
  cddlMatched: number | null
  cddlError: string | null
  stoppedEarly: boolean
  error: string | null
}

export type SyncResult = {
  ranAt: string
  dryRun: boolean
  tookSeconds: number
  packages: PackageResult[]
}

type Opts = { budgetMs: number; packages?: string[]; dryRun?: boolean; stalePerRun?: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAconexReviewSync(db: any, opts: Opts): Promise<SyncResult> {
  const startedAt = Date.now()
  const ranAt = new Date().toISOString()
  const dryRun = !!opts.dryRun
  const msLeft = () => opts.budgetMs - (Date.now() - startedAt)
  const stalePerRun = opts.stalePerRun ?? 600
  const pkgs = (opts.packages && opts.packages.length ? opts.packages : [...TRACKED_PACKAGES])
    .map(p => p.toUpperCase())
  const results: PackageResult[] = []

  for (const pkg of pkgs) {
    const r: PackageResult = {
      package: pkg, listed: 0, inPackage: 0, newDocs: 0, changed: 0, staleRefreshed: 0, refreshed: 0,
      notInPackage: 0, missingFromAconex: 0, cddlMatched: null, cddlError: null, stoppedEarly: false, error: null,
    }
    results.push(r)
    try {
      if (msLeft() < 20_000) { r.stoppedEarly = true; r.error = 'no budget left for this package'; continue }

      // 1. list the register (4 pages in flight)
      const first = await ccGet<ListPage>(`mode=list&q=${encodeURIComponent(pkg)}&page=1`)
      const listed = new Map<string, ListDoc>()
      for (const d of first.docs) listed.set(d.docId, d)
      const totalPages = Math.max(1, first.totalPages)
      for (let p = 2; p <= totalPages; p += 4) {
        if (msLeft() < 15_000) { r.stoppedEarly = true; break }
        const batch = []
        for (let q = p; q < p + 4 && q <= totalPages; q++) batch.push(ccGet<ListPage>(`mode=list&q=${encodeURIComponent(pkg)}&page=${q}`))
        for (const page of await Promise.all(batch)) for (const d of page.docs) listed.set(d.docId, d)
      }
      r.listed = listed.size
      const fullyListed = !r.stoppedEarly

      // 2. what we already hold for this package
      type Held = { doc_id: string; revision: string | null; date_modified: string | null; synced_at: string | null; doc_owner: string | null; cddl_due: string | null; cddl_pct: number | null; docno: string }
      const held = new Map<string, Held>()
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('aconex_review_doc')
          .select('doc_id,revision,date_modified,synced_at,doc_owner,cddl_due,cddl_pct,docno')
          .eq('project_id', RDMC_PROJECT_ID).eq('package_code', pkg)
          .order('doc_id', { ascending: true }).range(from, from + 999)
        if (error) throw new Error(`aconex_review_doc read: ${error.message}`)
        for (const row of (data ?? []) as Held[]) held.set(row.doc_id, row)
        if (!data || data.length < 1000) break
      }

      // 3. decide what to (re)read
      const toFetch: string[] = []
      for (const [id, d] of listed) {
        const h = held.get(id)
        if (!h) { toFetch.push(id); r.newDocs++; continue }
        const moved = !sameInstant(d.dateModified, h.date_modified) ||
          ((d.revision || '').trim().toUpperCase() !== (h.revision || '').trim().toUpperCase())
        if (moved) { toFetch.push(id); r.changed++ }
      }
      const changedSet = new Set(toFetch)
      const stale = [...held.values()]
        .filter(h => listed.has(h.doc_id) && !changedSet.has(h.doc_id))
        .sort((a, b) => (a.synced_at ?? '').localeCompare(b.synced_at ?? ''))
        .slice(0, stalePerRun)
        .map(h => h.doc_id)
      if (fullyListed) r.missingFromAconex = [...held.keys()].filter(id => !listed.has(id)).length

      // 4. metadata → court → upsert, 40 per call, until the clock says stop
      const queue = [...toFetch, ...stale]
      const staleSet = new Set(stale)
      for (let i = 0; i < queue.length; i += 40) {
        if (msLeft() < 30_000) { r.stoppedEarly = true; break }
        const ids = queue.slice(i, i + 40)
        const { docs } = await ccGet<{ ok: boolean; docs: Meta[] }>(`mode=meta&ids=${ids.join(',')}`)
        const rows: Record<string, unknown>[] = []
        for (const m of docs) {
          if (!m.ok) continue
          if (!m.packageNo.toUpperCase().startsWith(pkg)) { r.notInPackage++; continue }
          const age = daysSince(m.dateModified)
          const [court, label, basis] = deriveCourt(m.reviewStatus, age, m.docStatus)
          const h = held.get(m.docId)
          rows.push({
            project_id: RDMC_PROJECT_ID, package_code: pkg, doc_id: m.docId,
            docno: m.docno, title: m.title, doc_type: m.docType, discipline: m.discipline,
            revision: m.revision, author_org: m.authorOrg, doc_status: m.docStatus,
            review_status: m.reviewStatus.replace(/&amp;/g, '&'), review_source: m.reviewSource,
            date_modified: m.dateModified || null,
            court, court_label: label, court_basis: basis,
            overdue: court === 'RDMC' && !!age && age > 180,
            days_in_court: age,
            // keep whatever CDDL enrichment the row already carries; step 5 refreshes it
            doc_owner: h?.doc_owner ?? null, cddl_due: h?.cddl_due ?? null, cddl_pct: h?.cddl_pct ?? null,
            synced_at: new Date().toISOString(),
          })
        }
        if (rows.length && !dryRun) {
          const { error } = await db.from('aconex_review_doc').upsert(rows, { onConflict: 'project_id,doc_id' })
          if (error) throw new Error(`aconex_review_doc upsert: ${error.message}`)
        }
        for (const row of rows) {
          held.set(String(row.doc_id), {
            doc_id: String(row.doc_id), revision: String(row.revision ?? ''), date_modified: (row.date_modified as string) ?? null,
            synced_at: row.synced_at as string, doc_owner: (row.doc_owner as string) ?? null,
            cddl_due: (row.cddl_due as string) ?? null, cddl_pct: (row.cddl_pct as number) ?? null, docno: String(row.docno),
          })
        }
        r.refreshed += rows.length
        r.staleRefreshed += rows.filter(row => staleSet.has(String(row.doc_id))).length
      }

      // 5. CDDL enrichment — fails soft; the register landing matters more
      if (msLeft() > 40_000) {
        try {
          const cddl = await loadCddl(pkg)
          const updates: Record<string, unknown>[] = []
          let matched = 0
          for (const h of held.values()) {
            const e = cddl.get((h.docno || '').toUpperCase())
            if (!e) continue
            matched++
            const same = (h.doc_owner ?? null) === e.doc_owner && (h.cddl_due ?? null) === e.cddl_due &&
              ((h.cddl_pct ?? null) === e.cddl_pct)
            if (!same) updates.push({ project_id: RDMC_PROJECT_ID, package_code: pkg, doc_id: h.doc_id, docno: h.docno, ...e })
          }
          r.cddlMatched = matched
          if (!dryRun) {
            for (let i = 0; i < updates.length; i += 500) {
              if (msLeft() < 10_000) { r.stoppedEarly = true; break }
              const { error } = await db.from('aconex_review_doc').upsert(updates.slice(i, i + 500), { onConflict: 'project_id,doc_id' })
              if (error) throw new Error(`CDDL upsert: ${error.message}`)
            }
          }
        } catch (e) {
          r.cddlError = e instanceof Error ? e.message : String(e)
        }
      } else {
        r.cddlError = 'skipped — no budget left'
      }

      r.inPackage = held.size

      // 6. the run record the tracker page reads for "Last synced"
      if (!dryRun) {
        const note = `vercel cron: listed ${r.listed}, new ${r.newDocs}, changed ${r.changed}, stale re-read ${r.staleRefreshed}` +
          (r.cddlMatched != null ? `, cddl ${r.cddlMatched}` : '') +
          (r.cddlError ? ` (cddl: ${r.cddlError.slice(0, 80)})` : '') +
          (r.stoppedEarly ? ' — stopped on the clock' : '')
        const { error } = await db.from('aconex_review_sync')
          .insert({ package_code: pkg, doc_count: r.inPackage, matched_count: r.refreshed, note })
        if (error) throw new Error(`aconex_review_sync insert: ${error.message}`)
      }
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e)
    }
  }

  return { ranAt, dryRun, tookSeconds: Math.round((Date.now() - startedAt) / 1000), packages: results }
}
