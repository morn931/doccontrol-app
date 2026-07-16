import { createServiceClient } from '@/lib/supabase/server'
import { BookOpen } from 'lucide-react'
import { CddlRegister, type CddlRow } from './cddl-register'
import { getCddlMode } from './actions'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type SyncMeta = { ran_at: string; doc_count: number } | null

const COLS =
  'docno,ppe_docno,wbs,discipline,doc_type,revision,title,area_facility,broad_type,' +
  'rev_a_transmittal,rev0_transmittal,aconex_doc_status,aconex_review_status,' +
  'pct_complete,doc_owner,doc_owner_initials,comments,due,schedule_status,activity_id,main_group,sub_group,bh,drawing_pack,retired,package_code'

export default async function CddlPage() {
  const supabase = createServiceClient()

  // editing role + register mode
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  let canEdit = false
  if (user) {
    const { data: profile } = await auth.from('users').select('role').eq('auth_user_id', user.id).single()
    canEdit = ['admin', 'document_controller', 'developer'].includes((profile?.role ?? '') as string)
  }
  const mode = await getCddlMode().catch(() => 'excel_master')

  let rows: CddlRow[] = []
  let sync: SyncMeta = null
  let tableMissing = false

  // PostgREST caps responses at max_rows (1000) — page through in chunks.
  // 'retired' arrives with migration 017; fall back to the 016 column set until applied.
  const fetchAll = async (cols: string) => {
    const out: CddlRow[] = []
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await supabase
        .from('cddl_doc')
        .select(cols)
        .order('docno', { ascending: true })
        .range(from, from + 999)
      if (error) return { rows: out, error }
      out.push(...((data ?? []) as unknown as CddlRow[]))
      if (!data || data.length < 1000) break
    }
    return { rows: out, error: null }
  }
  let res = await fetchAll(COLS)
  if (res.error) res = await fetchAll(COLS.replace(',retired,', ','))
  if (res.error) tableMissing = true
  rows = res.rows

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
            Aconex statuses refresh daily at 06:00. Management follows the mode banner below.
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
        <CddlRegister rows={rows} canEdit={canEdit} mode={mode} />
      )}
    </div>
  )
}
