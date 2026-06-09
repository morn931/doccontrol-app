import { createServiceClient } from '@/lib/supabase/server'
import { awardedVendor, NOT_AWARDED } from '@/lib/package-vendors'

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

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Vendors &amp; Packages</h1>
        <p className="text-gray-500 text-sm mt-1">Project packages and the vendor each is awarded to (PPE&apos;s own engineering = K124).</p>
      </div>

      <div className="card divide-y divide-gray-50">
        {rows.map((p: any) => {
          const awarded = p.vendor !== NOT_AWARDED
          return (
            <div key={p.id} className="px-6 py-4 flex items-center gap-4">
              <span className="px-2 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold shrink-0">{p.package_code}</span>
              <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">{p.package_name || p.package_code}</span>
              <span className={
                'px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ' +
                (awarded ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-400')
              }>
                {awarded ? `Awarded: ${p.vendor}` : NOT_AWARDED}
              </span>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">No packages found.</div>
        )}
      </div>
    </div>
  )
}
