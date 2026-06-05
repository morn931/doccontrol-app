import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function VendorsPage() {
  const db = createServiceClient()
  const { data: vendors } = await db.from('vendors').select('*, packages(id, package_code, package_name)').order('name')
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Vendors & Packages</h1>
        <p className="text-gray-500 text-sm mt-1">Vendor companies and their associated project packages</p>
      </div>
      <div className="card divide-y divide-gray-50">
        {(vendors ?? []).map((v: any) => (
          <div key={v.id} className="px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 bg-navy-100 text-navy-700 rounded text-xs font-mono font-bold">{v.code}</span>
              <span className="font-semibold text-gray-900">{v.name}</span>
              {v.primary_contact_email && <span className="text-sm text-gray-400">{v.primary_contact_email}</span>}
            </div>
            {v.packages?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {v.packages.map((p: any) => (
                  <span key={p.id} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                    {p.package_code} — {p.package_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
