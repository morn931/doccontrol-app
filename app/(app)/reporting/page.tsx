import Link from 'next/link'
import { BarChart3, LineChart, Table2, Boxes, ArrowRight } from 'lucide-react'

const REPORTS = [
  {
    href: '/reporting/engineering-tracker',
    title: 'Engineering Tracker',
    description: 'Per-package engineering progress — budget hours, earned value and progress vs plan, computed live from the MDDR and review system. Filter by package or view the full tracker.',
    icon: LineChart,
    ready: true,
  },
  {
    href: '/reporting/package-progress',
    title: 'Package Progress Summary',
    description: 'Per-package document counts and progress — active docs, planned vs actual %, approvals, missing due dates and variance. Live from the MDDR.',
    icon: Table2,
    ready: true,
  },
  {
    href: '/reporting/phase1-deliverables',
    title: 'PPE Phase 1 Engineering Deliverables',
    description: 'PPE CDDL deliverables grouped by WBS code — total docs, placeholders and 3-milestone completion (Rev A / Rev 0 / Approved). Filter by WBS.',
    icon: Boxes,
    ready: true,
  },
]

export default function ReportingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-navy-600" /> Reporting
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Progress and performance reports off the Master Register.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map(r => (
          <Link key={r.href} href={r.href}
            className="card p-5 hover:border-navy-300 hover:shadow-sm transition group">
            <div className="flex items-center gap-2 text-navy-700">
              <r.icon className="h-5 w-5" />
              <span className="font-semibold">{r.title}</span>
            </div>
            <p className="text-sm text-gray-500 mt-2">{r.description}</p>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 mt-3 group-hover:gap-2 transition-all">
              Open report <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
