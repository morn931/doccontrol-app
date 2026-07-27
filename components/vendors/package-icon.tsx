// Vendor name (as returned by lib/package-vendors.ts) -> logo file in /public/vendor-logos.
// Same asset set + mapping style as CoreCost (costflow-app/src/components/package-icon.tsx)
// so Vendors & Packages looks consistent across the platform. No entry = placeholder shown.
const VENDOR_LOGOS: Record<string, string> = {
  ABB: '/vendor-logos/abb.png',
  Crestchic: '/vendor-logos/crestchic.png',
  Orient: '/vendor-logos/orient.jpg',
  PSI: '/vendor-logos/psi.jpg',
  Siemens: '/vendor-logos/siemens.png',
  PPE: '/vendor-logos/ppe.png',
  Fuelco: '/vendor-logos/fuelco.png',
}

/**
 * Vendor logo for a package, sized to fill a `size`-tall square (e.g. `size="h-16 w-16"`).
 * Mirrors CoreCost's PackageIcon so the two apps present vendors the same way.
 */
export default function PackageIcon({
  vendorName,
  packageCode,
  size = 'h-16 w-16',
}: {
  vendorName: string | null | undefined
  packageCode?: string | null
  size?: string
}) {
  const logo = vendorName ? VENDOR_LOGOS[vendorName] : undefined

  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={vendorName ?? ''} className={`${size} rounded-2xl object-contain`} />
  }
  return (
    <div className={`${size} flex items-center justify-center rounded-2xl bg-slate-50 text-xs font-semibold text-slate-400`}>
      {packageCode}
    </div>
  )
}
