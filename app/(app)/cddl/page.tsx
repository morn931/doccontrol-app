import { createServiceClient } from '@/lib/supabase/server'
import { BookOpen } from 'lucide-react'
import { CddlRegister, type CddlRow } from './cddl-register'

export const dynamic = 'force-dynamic'

type SyncMeta = { ran_at: string; doc_count: number } | null

const COLS =
  'docno,ppe_docno,wbs,discipline,doc_type,revision,title,area_facility,broad_type,' +
  'rev_a_transmittal,rev0_transmittal,aconex_doc_status,aconex_review_status,' +
  'pct_complete,doc_owner,doc_owner_initials,comments,due,schedule_status,package_code'

export default async function CddlPage() {
  const supabase = createServiceClient()

  let rows: CddlRow[] = []
  let sync: SyncMeta = null
  let tableMissing = false

  // PostgREST caps responses at max_rows (1000) — page through in chunks.
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase
      .from('cddl_doc')
      .select(COLS)
      .order('docno', { ascending: true })
      .range(from, from + 999)
    if (error) { tableMissing = rows.length === 0; break }
    rows.push(...((data ?? []) as unknown as CddlRow[]))
    if (!data || data.length < 1000) break
  }

  if (!tableMissing) {
    const { data: s } = await supabase
      .from('cddl_sync')
      .select('ran_at,doc_count')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    sync = s as SyncMeta
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy-800 flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-navy-500" />
            CDDL Register — Phase 1
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              synced from the CDDL workbook
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            The Contractor Document &amp; Data List, moved from the Excel management sheet onto the platform.
            Mirrors Document Control&apos;s workbook (refreshed daily at 06:00) — read-only here until
            Document Control manages the CDDL in Coreflow permanently.
          </p>
        </div>
        {sync && (
          <div className="text-right text-xs text-slate-400">
            Last synced<br />
            <span className="text-slate-600 font-medium">
              {new Date(sync.ran_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
        )}
      </div>

      {tableMissing ? (
        <div className="card p-6 text-sm text-slate-600">
          The CDDL register table is not set up yet — apply CoreDocs migration
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">016_cddl_register.sql</code>
          and run <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">scripts/cddl_sync.py</code>
          (costflow-app) to load it.
        </div>
      ) : (
        <CddlRegister rows={rows} />
      )}
    </div>
  )
}
