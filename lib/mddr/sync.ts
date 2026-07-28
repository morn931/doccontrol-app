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
  aiText: string | null
}

export interface SyncResult {
  matched: number
  updated: number
  skipped: number
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
      .select('id, document_id, file_name, revision, is_latest, ai_text')
      .range(from, from + 999)
    if (error) throw new Error(`document_versions: ${error.message}`)
    for (const v of data ?? []) {
      const parsed = parseDocumentFileName(v.file_name ?? '')
      const key = normalizeDocNumber(parsed.normalizedDocumentNumber)
      if (!key) continue
      const info: VersionInfo = {
        versionId: v.id, documentId: v.document_id ?? null,
        revision: v.revision ?? parsed.revision, isLatest: !!v.is_latest,
        outcomes: outcomesByVersion.get(v.id) ?? [], aiText: v.ai_text ?? null,
      }
      const cur = byDocNumber.get(key)
      const better = !cur || (info.isLatest && !cur.isLatest) ||
        (info.isLatest === cur.isLatest && compareRevisions(info.revision, cur.revision) >= 0)
      if (better) byDocNumber.set(key, info)
    }
    if (!data || data.length < 1000) break
  }

  // ── apply to awarded MDDR entries ──
  let matched = 0, updated = 0, skipped = 0
  const errors: string[] = []
  const sameRev = (a?: string | null, b?: string | null) => (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase()
  // Option C: `revision` should reflect the file on record (as-issued). When the
  // register carried a forward numeric IFC target (e.g. "0") while the file is the
  // approved draft, move that value to `target_revision`.
  const reconcileRev = (e: any, fileRev: string | null): Record<string, string | null> => {
    const fr = (fileRev ?? '').trim()
    const reg = (e.revision ?? '').trim()
    // ONLY the reported defect: register = forward numeric IFC target (0/1…), file =
    // approved draft letter (A/B/C…). Blanks / letter-letter / numeric-numeric untouched.
    if (!fr || !/^\d+$/.test(reg) || !/^[A-Za-z]/.test(fr) || sameRev(fr, reg)) return {}
    const patch: Record<string, string | null> = { revision: fr }
    if (!e.target_revision) patch.target_revision = reg
    return patch
  }
  for (let from = 0; ; from += 500) {
    let q = db.from('mddr_entries')
      .select('id, normalized_document_number, weighting_total, progress_source, revision, target_revision')
      .eq('is_active', true)
      .not('normalized_document_number', 'is', null)
      .order('id', { ascending: true })   // stable order for offset pagination
      .range(from, from + 499)
    if (pkg) q = q.eq('package_code', pkg)
    const { data: entries, error } = await q
    if (error) throw new Error(`mddr_entries: ${error.message}`)
    if (!entries || entries.length === 0) break

    for (const e of entries) {
      const info = byDocNumber.get(e.normalized_document_number)
      if (!info) continue
      matched++

      // Revision reconciliation (Option C) applies to EVERY matched row — including
      // register-/rules-owned ones — so the index always reflects the file on record.
      const update: Record<string, any> = reconcileRev(e, info.revision)

      // Progress is owned elsewhere for these sources — don't touch it:
      //  · 'register'       — set from an uploaded SDDR/CDDL (ABB packages).
      //  · 'rules_of_credit'— hard-coded Rules-of-Credit (Siemens K125 / PPE K124).
      const progressOwnedElsewhere = e.progress_source === 'register' || e.progress_source === 'rules_of_credit'
      if (!progressOwnedElsewhere) {
        const outcome = worstCaseOutcome(info.outcomes)
        const prog = computeProgress({ hasSubmission: true, latestOutcome: outcome, latestRevision: info.revision })
        const earned = e.weighting_total != null ? (prog.percent / 100) * Number(e.weighting_total) : null
        Object.assign(update, {
          progress_percent: prog.percent, progress_milestone: prog.milestone, progress_source: 'review_system',
          review_outcome_code: outcome, earned_value: earned,
          ai_text: info.aiText,
          linked_document_id: info.documentId, linked_version_id: info.versionId,
          status_synced_at: new Date().toISOString(),
          stage_submitted: prog.milestone >= 1, stage_reviewed: prog.milestone >= 2, stage_approved: prog.milestone >= 3,
        })
      }

      if (Object.keys(update).length === 0) { skipped++; continue }
      const { error: uErr } = await db.from('mddr_entries').update(update).eq('id', e.id)
      if (uErr) errors.push(`${e.normalized_document_number}: ${uErr.message}`); else updated++
    }
    if (entries.length < 500) break
  }

  return { matched, updated, skipped, liveVersionsIndexed: byDocNumber.size, errors: errors.slice(0, 20) }
}
