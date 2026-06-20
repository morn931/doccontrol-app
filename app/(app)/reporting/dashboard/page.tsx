'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, Loader2, RefreshCw, ArrowLeft } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Line, Area, BarChart, Bar, Cell, LabelList,
  PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'
import { cn } from '@/lib/utils/cn'

interface DashData {
  scurve:    { month: string; planned: number; actual: number | null }[]
  byPackage: { package: string; planned: number; actual: number }[]
  variance:  { package: string; variance: number }[]
  milestones:{ name: string; value: number }[]
  totalDocs: number; scopeDocs: number; plannedNow: number; actualNow: number
  todayMonth: string; generatedAt: string
}

const NAVY = '#1e3a5f', TEAL = '#0d9488', GREEN = '#16a34a', RED = '#dc2626'
const MILESTONE_COLORS = ['#cbd5e1', '#fbbf24', '#38bdf8', '#0d9488', '#16a34a']
const SOURCES = ['ALL', 'SDDR', 'CDDL', 'MDDR']

function Chip({ active, onClick, children, color = 'navy' }: any) {
  const on = color === 'teal' ? 'bg-teal-600 border-teal-600' : color === 'purple' ? 'bg-purple-600 border-purple-600'
    : color === 'amber' ? 'bg-amber-500 border-amber-500' : 'bg-navy-700 border-navy-700'
  return (
    <button onClick={onClick}
      className={cn('px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
        active ? `${on} text-white` : 'bg-white text-slate-600 border-slate-300 hover:border-navy-400 hover:text-navy-700')}>
      {children}
    </button>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 flex flex-col break-inside-avoid">
      <div className="mb-2">
        <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
      <div className="h-[300px]">{children}</div>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn('text-xl font-bold', tone === 'green' ? 'text-green-600' : tone === 'red' ? 'text-red-600' : 'text-slate-900')}>{value}</p>
    </div>
  )
}

export default function ReportingDashboard() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [packages, setPackages] = useState<string[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [selPackage, setSelPackage] = useState('ALL')
  const [selVendor, setSelVendor] = useState('ALL')
  const [selSource, setSelSource] = useState('ALL')
  const [awarded, setAwarded] = useState<'true' | 'false'>('true')

  // Filter chips (reuse MDDR meta)
  useEffect(() => {
    const base = `/api/mddr/meta?awarded=${awarded}`
    const u = selPackage === 'ALL' ? base : `${base}&package=${encodeURIComponent(selPackage)}`
    fetch(u).then(r => r.json()).then(d => {
      if (selPackage === 'ALL') setPackages(d.packages ?? [])
      setVendors(d.vendors ?? [])
    }).catch(() => {})
  }, [awarded, selPackage])

  function load() {
    setLoading(true); setError(null)
    const p = new URLSearchParams({ awarded })
    if (selPackage !== 'ALL') p.set('package', selPackage)
    if (selVendor !== 'ALL') p.set('vendor', selVendor)
    if (selSource !== 'ALL') p.set('source', selSource)
    fetch(`/api/reporting/dashboard?${p}`)
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [selPackage, selVendor, selSource, awarded])

  const scopeParts = [
    selPackage !== 'ALL' && selPackage,
    selVendor !== 'ALL' && selVendor,
    selSource !== 'ALL' && selSource,
    awarded === 'true' ? 'Awarded' : 'Unawarded scope',
  ].filter(Boolean) as string[]
  const scope = selPackage === 'ALL' && selVendor === 'ALL' && selSource === 'ALL'
    ? (awarded === 'true' ? 'All awarded documents' : 'All unawarded scope')
    : scopeParts.join(' · ')

  const pct = (v: any) => `${v}%`
  const milestoneTotal = data?.milestones.reduce((s, m) => s + m.value, 0) ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reporting" className="text-xs text-slate-400 hover:text-navy-600 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Reporting
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-navy-600" /> Progress Dashboard
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            <span className="font-medium text-slate-700">{scope}</span>
            {data?.generatedAt && ` · as of ${new Date(data.generatedAt).toLocaleDateString()}`}
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Package:</span>
          {['ALL', ...packages].map(p => <Chip key={p} active={selPackage === p} onClick={() => { setSelPackage(p); setSelVendor('ALL') }}>{p}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Vendor:</span>
          {['ALL', ...vendors].map(v => <Chip key={v} color="teal" active={selVendor === v} onClick={() => setSelVendor(v)}>{v}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Source:</span>
          {SOURCES.map(s => <Chip key={s} color="purple" active={selSource === s} onClick={() => setSelSource(s)}>{s}</Chip>)}
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide ml-3">Show:</span>
          {([['true', 'Awarded docs'], ['false', 'Unawarded scope']] as const).map(([v, l]) =>
            <Chip key={v} color="amber" active={awarded === v} onClick={() => setAwarded(v)}>{l}</Chip>)}
        </div>
      </div>

      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}
      {!data && loading && <div className="card p-20 text-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>}

      {data && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="Documents" value={data.totalDocs.toLocaleString()} />
            <Kpi label="Scheduled (planned date)" value={data.scopeDocs.toLocaleString()} />
            <Kpi label="Planned % to date" value={`${data.plannedNow}%`} />
            <Kpi label="Actual % to date" value={`${data.actualNow}%`} />
            <Kpi label="Variance" value={`${data.actualNow - data.plannedNow > 0 ? '+' : ''}${(data.actualNow - data.plannedNow).toFixed(1)}%`}
              tone={data.actualNow - data.plannedNow >= 0 ? 'green' : 'red'} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* 1. S-CURVE */}
            <Card title="Progress S-Curve — Planned vs Actual"
              subtitle={`${scope} · ${data.scopeDocs.toLocaleString()} scheduled docs · Planned ${data.plannedNow}% vs Actual ${data.actualNow}% to date`}>
              <ResponsiveContainer>
                <ComposedChart data={data.scurve} margin={{ top: 16, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={pct} />
                  <Tooltip formatter={(v: any) => v == null ? '—' : `${v}%`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine x={data.todayMonth} stroke="#94a3b8" strokeDasharray="2 2"
                    label={{ value: 'Today', position: 'insideTopRight', fontSize: 10, fill: '#64748b' }} />
                  <Area type="monotone" dataKey="actual" name="Actual" stroke={TEAL} fill={TEAL} fillOpacity={0.15} strokeWidth={2} connectNulls
                    dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="planned" name="Planned" stroke={NAVY} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            {/* 2. PLANNED VS ACTUAL BY PACKAGE */}
            <Card title="Planned vs Actual by Package" subtitle={`${scope} · progress % to date`}>
              <ResponsiveContainer>
                <BarChart data={data.byPackage} margin={{ top: 18, right: 12, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="package" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={pct} />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="planned" name="Planned" fill={NAVY} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                    <LabelList dataKey="planned" position="top" fontSize={9} fill="#1e3a5f" formatter={(v: any) => `${v}%`} />
                  </Bar>
                  <Bar dataKey="actual" name="Actual" fill={TEAL} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                    <LabelList dataKey="actual" position="top" fontSize={9} fill="#0d9488" formatter={(v: any) => `${v}%`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* 3. DOCUMENT MATURITY */}
            <Card title="Document Maturity — Rules of Credit"
              subtitle={`${scope} · ${milestoneTotal.toLocaleString()} documents`}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.milestones} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={55} outerRadius={92} paddingAngle={2} isAnimationActive={false}
                    label={(e: any) => e.value ? `${e.value.toLocaleString()} (${((e.value / milestoneTotal) * 100).toFixed(0)}%)` : ''}
                    labelLine={false} fontSize={10}>
                    {data.milestones.map((_, i) => <Cell key={i} fill={MILESTONE_COLORS[i % MILESTONE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => `${Number(v).toLocaleString()} docs`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            {/* 4. SCHEDULE VARIANCE */}
            <Card title="Schedule Variance by Package" subtitle={`${scope} · Actual − Planned (ahead = green, behind = red)`}>
              <ResponsiveContainer>
                <BarChart data={data.variance} layout="vertical" margin={{ top: 5, right: 44, bottom: 0, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={pct} />
                  <YAxis type="category" dataKey="package" tick={{ fontSize: 10 }} width={48} />
                  <Tooltip formatter={(v: any) => `${v > 0 ? '+' : ''}${v}%`} />
                  <ReferenceLine x={0} stroke="#94a3b8" />
                  <Bar dataKey="variance" name="Variance" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                    {data.variance.map((d, i) => <Cell key={i} fill={d.variance >= 0 ? GREEN : RED} />)}
                    <LabelList dataKey="variance" position="right" fontSize={9}
                      formatter={(v: any) => `${v > 0 ? '+' : ''}${v}%`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
