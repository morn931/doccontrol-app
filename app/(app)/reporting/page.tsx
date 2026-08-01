import { QuickAccessCard } from '@/components/quick-access-card'

const ICON = (name: string) => `/coreflow/icons/${name}/transparent/${name}-128.png`

const REPORTS = [
  {
    href: '/reporting/dashboard',
    title: 'Progress Dashboard',
    blurb: 'Programme-wide S-curve, planned vs actual & variance',
    icon: ICON('dashboard'),
  },
  {
    href: '/reporting/engineering-tracker',
    title: 'Engineering Tracker',
    blurb: 'Budget hours & earned value by package',
    icon: ICON('engineering-tracker'),
  },
  {
    href: '/reporting/package-progress',
    title: 'Package Progress Summary',
    blurb: 'Doc counts & progress by package',
    icon: ICON('progress'),
  },
  {
    href: '/reporting/phase1-deliverables',
    title: 'PPE Phase 1 Engineering Deliverables',
    blurb: 'CDDL deliverables grouped by WBS code',
    icon: ICON('documents'),
  },
  {
    href: '/reporting/p6-export',
    title: 'P6 Activity-ID Progress Export',
    blurb: 'P6-ready CSV export for the planner',
    icon: ICON('reports'),
  },
]

export default function ReportingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ICON('reports')} alt="" className="h-6 w-6" /> Reporting
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">Progress and performance reports off the Master Register.</p>
      </div>

      <div className="mx-auto flex max-w-[944px] flex-wrap justify-center gap-4">
        {REPORTS.map(r => (
          <QuickAccessCard key={r.href} href={r.href} icon={r.icon} label={r.title} blurb={r.blurb} />
        ))}
      </div>
    </div>
  )
}
