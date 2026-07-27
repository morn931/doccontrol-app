import { createServiceClient } from '@/lib/supabase/server'
import { awardedVendor, NOT_AWARDED } from '@/lib/package-vendors'
import PackageIcon from '@/components/vendors/package-icon'

export default async function VendorsPage() {
  const db = createServiceClient()
  const { data: packages } = await db
    .from('packages')
    .select('id, package_code, package_name')
    .order('package_code')

  const rows = (packages ?? []).map((p: any) => ({
    ...p,
    vendor: awardedVendor(p.package_code),
  }))

  const card =
    'flex flex-col items-center gap-3 rounded-xl bg-white border border-slate-200 p-3 shadow-sm hover:border-teal-300 hover:shadow-md transition-all text-center'

  return (
    <div className="space-y-6 max-w-[1600px]">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Vendors &amp; Packages</h1>
        <p className="text-slate-500 text-sm mt-1">Project packages and the vendor each is awarded to (PPE&apos;s own engineering = K124).</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
        {rows.map((p: any) => {
          const awarded = p.vendor !== NOT_AWARDED
          return (
            <div key={p.id} className={card}>
              <PackageIcon vendorName={awarded ? p.vendor : null} packageCode={p.package_code} size={awarded ? 'h-24 w-24' : 'h-16 w-16'} />
              <div>
                <span className="block text-sm font-semibold text-slate-900">
                  {p.package_code} — {p.package_name || p.package_code}
                </span>
                <span className={
                  'mt-1 inline-block px-2.5 py-1 rounded-full text-xs font-semibold ' +
                  (awarded ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-400')
                }>
                  {awarded ? `Awarded: ${p.vendor}` : NOT_AWARDED}
                </span>
              </div>
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-sm text-slate-500">No packages found.</p>
        )}
      </div>
    </div>
  )
}
