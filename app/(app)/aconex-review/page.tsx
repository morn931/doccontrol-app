import { createServiceClient } from '@/lib/supabase/server'
import { Link2, AlertTriangle } from 'lucide-react'
import { ReviewBoard, type ReviewRow } from './review-board'
import { AconexSearch } from './aconex-search'

export const dynamic = 'force-dynamic'

type SyncMeta = { ran_at: string; doc_count: number; matched_count: number } | null

export default async function AconexReviewPage() {
  const supabase = createServiceClient()

  let rows: ReviewRow[] = []
  let sync: SyncMeta = null
  let tableMissing = false

  const BASE_COLS = 'doc_id,docno,title,discipline,revision,doc_status,review_status,court,court_label,court_basis,overdue,days_in_court,date_modified,package_code'
  // PostgREST caps responses at max_rows (1000) regardless of .limit — page
  // through in 1000-row chunks so the full register (4,984 K124 docs) loads.
  // CDDL columns arrive with migration 015 — fall back to the base set until applied.
  const fetchAll = async (cols: string) => {
    const all: unknown[] = []
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await supabase
        .from('aconex_review_doc')
        .select(cols)
        .order('court', { ascending: true })
        .order('days_in_court', { ascending: false })
        .range(from, from + 999)
      if (error) return { data: null, error }
      all.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    return { data: all, error: null }
  }
  let { data, error } = await fetchAll(`${BASE_COLS},doc_owner,cddl_due`)
  if (error) {
    ;({ data, error } = await fetchAll(BASE_COLS))
  }

  if (error) {
    // Table not created yet (migration 014 not applied) — show a friendly setup state.
    tableMissing = true
  } else {
    rows = (data ?? []) as ReviewRow[]
    const { data: s } = await supabase
      .from('aconex_review_sync')
      .select('ran_at,doc_count,matched_count')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    sync = s as SyncMeta
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Link2 className="h-6 w-6 text-navy-600" /> Aconex Review Tracker
            </h1>
            <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5 border border-orange-200">
              ACONEX · live
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Document-review status read live from Oracle Aconex — <strong>Phase 1 (K124)</strong> and{' '}
            <strong>Early Works (K038)</strong>. Shows whose court each document is in, so “Pending”
            is no longer a mystery.
          </p>
        </div>
        {sync && (
          <div className="text-xs text-slate-400 text-right">
            <div>Last synced</div>
            <div className="font-medium text-slate-600">
              {new Date(sync.ran_at).toLocaleString('en-ZA')}
            </div>
          </div>
        )}
      </div>

      {/* Live search across the WHOLE Aconex register (not limited to the tracked pilot) */}
      <AconexSearch />

      <div className="flex items-center gap-2 pt-2">
        <h2 className="text-sm font-semibold text-slate-700">Tracked board</h2>
        <span className="text-xs text-slate-400">whose-court + overdue, synced</span>
      </div>

      {tableMissing ? (
        <div className="card p-6 flex items-start gap-3 text-sm">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-slate-800">Not set up yet</p>
            <p className="text-slate-500 mt-1">
              Apply migration <code>014_aconex_review_tracker.sql</code> in Supabase, then run{' '}
              <code>DRY=0 python scripts/aconex_review_sync.py</code> to populate the tracker.
            </p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">
          No documents synced yet. Run the Aconex sync to populate the review board.
        </div>
      ) : (
        <ReviewBoard rows={rows} />
      )}

      <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
        Court is derived from the Aconex review status. Documents RDMC has actioned (Reviewed / With
        comments / Rejected — Revise &amp; Resubmit) sit in <strong>PPE&apos;s court</strong>; approved /
        acknowledged are closed. <strong>“Pending”</strong> documents are shown as awaiting RDMC review —
        an assumption, because Aconex does not expose the reviewer assignment via the API. Confirm the
        “Pending” rule with Document Control.
      </p>
    </div>
  )
}
