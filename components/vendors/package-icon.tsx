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
  PRDW: '/vendor-logos/prdw.png',
  Wartsila: '/vendor-logos/wartsila.png',
  Fluor: '/vendor-logos/fluor.avif',
}

// Package codes that show an extra vendor logo alongside their primary one
// (e.g. K138's PSI contract also involves Capital Drilling on site — mirrors CoreCost).
const EXTRA_LOGOS: Record<string, string> = {
  K138: '/vendor-logos/capital-drilling.jpg',
  ICTS: '/vendor-logos/icts.png',
}

function BatteryIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3/5 w-3/5">
      <rect x="18" y="6" width="12" height="6" rx="1.5" fill="#0097A3" />
      <rect x="10" y="12" width="44" height="46" rx="6" fill="#0B3563" />
      <rect x="15" y="17" width="34" height="36" rx="3" fill="white" />
      <path d="M32 24 L23 39 H30 L28 46 L39 30 H32 L32 24Z" fill="#0097A3" />
    </svg>
  )
}
function SolarPanelIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3/5 w-3/5">
      <rect x="6" y="12" width="52" height="36" rx="2" fill="#0B3563" />
      <g stroke="white" strokeWidth="1.5">
        <line x1="6" y1="24" x2="58" y2="24" />
        <line x1="6" y1="36" x2="58" y2="36" />
        <line x1="19.3" y1="12" x2="19.3" y2="48" />
        <line x1="32.7" y1="12" x2="32.7" y2="48" />
        <line x1="46" y1="12" x2="46" y2="48" />
      </g>
      <path d="M20 48 L14 58 M44 48 L50 58" stroke="#0097A3" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
// Power Factor Correction Filter Bank — capacitor-bank glyph for E103 (not yet awarded).
function FilterBankIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3/5 w-3/5">
      <rect x="8" y="10" width="48" height="44" rx="4" fill="#0B3563" />
      <rect x="14" y="16" width="10" height="32" rx="2" fill="white" />
      <rect x="27" y="16" width="10" height="32" rx="2" fill="white" />
      <rect x="40" y="16" width="10" height="32" rx="2" fill="white" />
      <g stroke="#0097A3" strokeWidth="2.5">
        <line x1="19" y1="22" x2="19" y2="42" />
        <line x1="32" y1="22" x2="32" y2="42" />
        <line x1="45" y1="22" x2="45" y2="42" />
      </g>
    </svg>
  )
}
// Package codes with no vendor loaded yet (not awarded) get a generic domain icon.
const CUSTOM_ICONS: Record<string, () => React.ReactElement> = {
  K108: BatteryIcon,
  K110: SolarPanelIcon,
  E103: FilterBankIcon,
}

/**
 * Vendor logo / custom icon for a package, sized to fill a `size`-tall square
 * (e.g. `size="h-16 w-16"`). Mirrors CoreCost's PackageIcon so the two apps
 * present vendors/packages the same way.
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
  const extraLogo = packageCode ? EXTRA_LOGOS[packageCode] : undefined
  const CustomIcon = packageCode ? CUSTOM_ICONS[packageCode] : undefined

  if (logo && extraLogo) {
    return (
      <div className={`flex ${size} flex-col items-center justify-center gap-1`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={vendorName ?? ''} className="h-1/2 w-full rounded-2xl object-contain" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={extraLogo} alt="" className="h-1/2 w-full rounded-2xl object-contain" />
      </div>
    )
  }
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={vendorName ?? ''} className={`${size} rounded-2xl object-contain`} />
  }
  if (CustomIcon) {
    return (
      <div className={`${size} flex items-center justify-center rounded-2xl bg-[#f4f7f9]`}>
        <CustomIcon />
      </div>
    )
  }
  return (
    <div className={`${size} flex items-center justify-center rounded-2xl bg-slate-50 text-xs font-semibold text-slate-400`}>
      {packageCode}
    </div>
  )
}
