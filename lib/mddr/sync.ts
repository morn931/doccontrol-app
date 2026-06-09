/**
 * Shared MDDR progress sync — used by /api/mddr/sync and scripts/sync-direct.ts.
 *
 * Carries the latest review status from the live document-control system into the
 * MDDR master and applies the agreed Rules of Credit (lib/mddr/rules-of-credit).
 * Matching is by normalized document number: mddr_entries.normalized_document_number
 * ↔ the number parsed from document_versions.file_name.
 */
import { parseDocumentFileName, compareRevisions } from '../utils/document-number-parser'
import { normalizeDocNumber } from './mapping'
import { computeProgress, worstCaseOutcome } from './rules-of-credit'

interface VersionInfo {
  versionId: string
  documentId: string | null
  revision: string | null
  isLatest: boolean
  outcomes: string[]
}

export interface SyncResult {
  matched: number
  updated: number
  liveVersionsIndexed: number
  errors: string[]
}

export async function syncProgress(db: any, opts: { packageCode?: string } = {}): Promise<SyncResult> {
  const pkg = opts.packageCode

  // ── review outcomes: version_id → [codes] ──
  const outcomesByVersion = new Map<string, string[]>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('review_tasks')
      .select('document_version_id, review_outcome_code')
      .not('review_outcome_code', 'is', null)
      .range(from, from + 999)
    if (error) throw new Error(`review_tasks: ${error.message}`)
    for (const t of data ?? []) {
      if (!t.document_version_id) continue
      const arr = outcomesByVersion.get(t.document_version_id) ?? []
      arr.push(t.review_outcome_code)
      outcomesByVersion.set(t.document_version_id, arr)
    }
    if (!data || data.length < 1000) break
  }

  // ── live versions indexed by normalized doc number ──
  const byDocNumber = new Map<string, VersionInfo>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('document_versions')
      .select('id, document_id, file_name, revision, is_latest')
      .range(from, from + 999)
    if (error) throw new Error(`document_versions: ${error.message}`)
    for (const v of data ?? []) {
      const parsed = parseDocumentFileName(v.file_name ?? '')
      const key = normalizeDocNumber(parsed.normalizedDocumentNumber)
      if (!key) continue
      const info: VersionInfo = {
        versionId: v.id, documentId: v.document_id ?? null,
        revision: v.revision ?? parsed.revision, isLatest: !!v.is_latest,
        outcomes: outcomesByVersion.get(v.id) ?? [],
      }
      const cur = byDocNumber.get(key)
      const better = !cur || (info.isLatest && !cur.isLatest) ||
        (info.isLatest === cur.isLatest && compareRevisions(info.revision, cur.revision) >= 0)
      if (better) byDocNumber.set(key, info)
    }
    if (!data || data.length < 1000) break
  }

  // ── apply to awarded MDDR entries ──
  let matched = 0, updated = 0
  const errors: string[] = []
  for (let from = 0; ; from += 500) {
    let q = db.from('mddr_entries')
      .select('id, normalized_document_number, weighting_total')
      .eq('is_active', true)
      .not('normalized_document_number', 'is', null)
      .range(from, from + 499)
    if (pkg) q = q.eq('package_code', pkg)
    const { data: entries, error } = await q
    if (error) throw new Error(`mddr_entries: ${error.message}`)
    if (!entries || entries.length === 0) break

    for (const e of entries) {
      const info = byDocNumber.get(e.normalized_document_number)
      if (!info) continue
      matched++
      const outcome = worstCaseOutcome(info.outcomes)
      const prog = computeProgress({ hasSubmission: true, latestOutcome: outcome, latestRevision: info.revision })
      const earned = e.weighting_total != null ? (prog.percent / 100) * Number(e.weighting_total) : null
      const { error: uErr } = await db.from('mddr_entries').update({
        progress_percent: prog.percent, progress_milestone: prog.milestone, progress_source: 'review_system',
        review_outcome_code: outcome, earned_value: earned,
        linked_document_id: info.documentId, linked_version_id: info.versionId,
        status_synced_at: new Date().toISOString(),
        stage_submitted: prog.milestone >= 1, stage_reviewed: prog.milestone >= 2, stage_approved: prog.milestone >= 3,
      }).eq('id', e.id)
      if (uErr) errors.push(`${e.normalized_document_number}: ${uErr.message}`); else updated++
    }
    if (entries.length < 500) break
  }

  return { matched, updated, liveVersionsIndexed: byDocNumber.size, errors: errors.slice(0, 20) }
}
