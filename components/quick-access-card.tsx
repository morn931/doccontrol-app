import Link from 'next/link'
import Image from 'next/image'

// Shared "quick access" tile — originally the Dashboard's landing-page card
// style (128px branded icon, w-56 rounded-xl card, centered label + blurb).
// Reused wherever a page wants tiles that match the Dashboard look (e.g.
// Reporting) instead of drifting into a page-specific card style.
const cardCls = 'group relative flex w-56 shrink-0 flex-col items-center gap-3 rounded-xl bg-white border border-slate-200 p-3 shadow-sm hover:border-teal-300 hover:shadow-md transition-all text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500'
const cardClsActive = 'group relative flex w-56 shrink-0 flex-col items-center gap-3 rounded-xl bg-brand border border-brand p-3 shadow-sm hover:border-brand-dark hover:shadow-md transition-all text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark'
const iconCls = 'h-32 w-32 rounded-2xl object-cover transition-transform duration-200 group-hover:scale-105'
const iconInsetCls = 'flex h-32 w-32 items-center justify-center rounded-2xl bg-white p-3 transition-transform duration-200 group-hover:scale-105'

export function QuickAccessCard({ href, icon, label, blurb, count }: { href: string; icon: string; label: string; blurb: string; count?: number }) {
  const active = (count ?? 0) > 0

  if (!active) {
    return (
      <Link href={href} className={cardCls}>
        <Image src={icon} alt="" width={128} height={128} className={iconCls} />
        <div>
          <span className="text-sm font-semibold text-[#0B3563] group-hover:text-teal-700 block">{label}</span>
          <span className="text-xs text-slate-500 mt-0.5 block">{blurb}</span>
        </div>
      </Link>
    )
  }

  const documentsLabel = count === 1 ? '1 document needs review' : `${count} documents need review`
  return (
    <Link href={href} className={cardClsActive}>
      <span className="absolute -top-2 -right-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-[#1B3464] px-1.5 text-xs font-bold text-white shadow">
        {count}
      </span>
      <div className={iconInsetCls}>
        <Image src={icon} alt="" width={128} height={128} className="h-full w-full rounded-xl object-cover" />
      </div>
      <div>
        <span className="text-sm font-semibold text-white block">{label}</span>
        <span className="text-xs text-teal-50 mt-0.5 block">{documentsLabel}</span>
      </div>
    </Link>
  )
}
