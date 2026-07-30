import { createServiceClient } from '@/lib/supabase/server'
import { AlertTriangle } from 'lucide-react'
import { RfiBoard, type Rfi } from './rfi-board'

export const dynamic = 'force-dynamic'

// RFI Tracker — read-only mirror of Aconex RFI correspondence (one row per
// mail thread), fed by costflow-app/scripts/aconex_rfi_sync.py on the daily
// 06:00 Aconex scan. Kept deliberately separate from CoreCost's PDN register:
// RFIs are the engineers' review queue, not commercial change items.
export default async function RfiTrackerPage() {
  const supabase = createServiceClient()

  let rows: Rfi[] = []
  let syncedAt: string | null = null
  let tableMissing = false

  const BASE_COLS =
    'id,thread_id,mail_no,corr_type,title,package_code,package_full,cause,cost_impact,schedule_impact,from_org,from_user,raised_date,response_due,aconex_status,last_mail_date,days_silent,mail_count,attachment_count,court_who,court_people,court_side,overdue,closed,summary'
  const fetchRows = (cols: string) =>
    supabase.from('aconex_rfi').select(cols).order('last_mail_date', { ascending: false }).limit(2000)
  // ppe_responsible arrives with migration 027 — fall back to the base set until applied.
  let { data, error } = await fetchRows(`${BASE_COLS},ppe_responsible,ppe_responsible_manual`)
  if (error) {
    ;({ data, error } = await fetchRows(BASE_COLS))
  }
  if (error) {
    tableMissing = true
  } else {
    rows = (data ?? []) as unknown as Rfi[]
    const { data: sync } = await supabase
      .from('aconex_rfi_sync')
      .select('ran_at')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    syncedAt = sync?.ran_at ?? null
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-navy-800">RFI Tracker</h1>
        <p className="mt-1 text-sm text-slate-500">
          Requests For Information from Aconex — whose court, response status and full correspondence, without logging into Aconex.
        </p>
      </div>

      {tableMissing ? (
        <div className="card flex items-start gap-3 border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            The RFI tables aren&apos;t provisioned yet — apply CoreDocs migration <b>026_aconex_rfi.sql</b> in the
            Supabase SQL editor, then run <code>DRY=0 python scripts/aconex_rfi_sync.py</code> from costflow-app.
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">
          No RFIs synced yet — run <code>DRY=0 python scripts/aconex_rfi_sync.py</code> from costflow-app to load them.
        </div>
      ) : (
        <RfiBoard rows={rows} syncedAt={syncedAt} />
      )}
    </div>
  )
}
