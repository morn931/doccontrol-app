import { createServiceClient } from '@/lib/supabase/server'
import { Factory } from 'lucide-react'
import { SddrRegister, type SddrRow } from './sddr-register'

export const dynamic = 'force-dynamic'

type SyncMeta = { ran_at: string } | null

const COLS =
  'docno,package_code,wbs,discipline,doc_type,revision,sheet,area_facility,major_desc,broad_type,' +
  'title,due,doc_owner,ifr_transmittal,ifc_transmittal,ppe_doc_status,pct_complete,' +
  'as_built,cert_final,tag_no,comments,issued_for,sub_supplier,activity_id,vendor_doc_id'

export default async function SddrPage() {
  const supabase = createServiceClient()

  let rows: SddrRow[] = []
  let sync: SyncMeta = null
  let tableMissing = false

  // PostgREST caps responses at max_rows (1000) — page through in chunks.
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase
      .from('sddr_doc')
      .select(COLS)
      .order('docno', { ascending: true })
      .range(from, from + 999)
    if (error) { tableMissing = true; break }
    rows.push(...((data ?? []) as unknown as SddrRow[]))
    if (!data || data.length < 1000) break
  }

  if (!tableMissing) {
    const { data: s } = await supabase
      .from('sddr_sync')
      .select('ran_at')
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
            <Factory className="h-6 w-6 text-navy-500" />
            SDDR Registers
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
              synced from the vendors&apos; workbooks
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            The Supplier Document &amp; Data Registers, mirrored daily at 06:00 from each package
            site on SharePoint. Vendors keep managing these in Excel — this view is read-only.
            If a vendor replaces their file (broken link), the sync finds the newest
            &ldquo;SDDR&rdquo; workbook on the site automatically.
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
          The SDDR register table is not set up yet — apply CoreDocs migration
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">019_sddr_register.sql</code>
          and run <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">scripts/sddr_sync.py</code>
          (costflow-app) to load it.
        </div>
      ) : (
        <SddrRegister rows={rows} />
      )}
    </div>
  )
}
