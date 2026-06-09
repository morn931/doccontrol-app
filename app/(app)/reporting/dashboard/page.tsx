'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, Loader2, RefreshCw, ArrowLeft } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Line, Area, BarChart, Bar, Cell,
  PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'

interface DashData {
  scurve:    { month: string; planned: number; actual: number | null }[]
  byPackage: { package: string; planned: number; actual: number }[]
  variance:  { package: string; variance: number }[]
  milestones:{ name: string; value: number }[]
  scopeDocs: number
  generatedAt: string
}

const NAVY = '#1e3a5f', TEAL = '#0d9488', GREEN = '#16a34a', RED = '#dc2626'
const MILESTONE_COLORS = ['#cbd5e1', '#fbbf24', '#38bdf8', '#0d9488', '#16a34a']

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 flex flex-col">
      <div className="mb-2">
        <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      </div>
      <div className="h-[300px]">{children}</div>
    </div>
  )
}

export default function ReportingDashboard() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true); setError(null)
    fetch('/api/reporting/dashboard')
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const pct = (v: any) => `${v}%`

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reporting" className="text-xs text-gray-400 hover:text-navy-600 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Reporting
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-navy-600" /> Progress Dashboard
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Live engineering progress across the programme
            {data?.generatedAt && ` · generated ${new Date(data.generatedAt).toLocaleString()}`}
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </button>
      </div>

      {error && <div className="card p-3 text-red-700 bg-red-50 text-sm">{error}</div>}
      {!data && loading && <div className="card p-20 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>}

      {data && (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* 1. S-CURVE */}
          <Card title="Progress S-Curve — Planned vs Actual"
            subtitle={`Cumulative % across ${data.scopeDocs.toLocaleString()} scheduled documents`}>
            <ResponsiveContainer>
              <ComposedChart data={data.scurve} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={pct} />
                <Tooltip formatter={(v: any) => v == null ? '—' : `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="actual" name="Actual" stroke={TEAL} fill={TEAL} fillOpacity={0.15} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="planned" name="Planned" stroke={NAVY} strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {/* 2. PLANNED VS ACTUAL BY PACKAGE */}
          <Card title="Planned vs Actual by Package" subtitle="Progress % to date per package">
            <ResponsiveContainer>
              <BarChart data={data.byPackage} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="package" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={pct} />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="planned" name="Planned" fill={NAVY} radius={[2, 2, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill={TEAL} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* 3. DOCUMENT MATURITY (RULES OF CREDIT) */}
          <Card title="Document Maturity — Rules of Credit" subtitle="Where the whole document bank sits">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.milestones} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={55} outerRadius={95} paddingAngle={2}
                  label={(e: any) => (e.value ? e.value.toLocaleString() : '')} labelLine={false}>
                  {data.milestones.map((_, i) => <Cell key={i} fill={MILESTONE_COLORS[i % MILESTONE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => `${Number(v).toLocaleString()} docs`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          {/* 4. SCHEDULE VARIANCE BY PACKAGE */}
          <Card title="Schedule Variance by Package" subtitle="Actual − Planned (ahead = green, behind = red)">
            <ResponsiveContainer>
              <BarChart data={data.variance} layout="vertical" margin={{ top: 5, right: 20, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={pct} />
                <YAxis type="category" dataKey="package" tick={{ fontSize: 10 }} width={48} />
                <Tooltip formatter={(v: any) => `${v > 0 ? '+' : ''}${v}%`} />
                <ReferenceLine x={0} stroke="#94a3b8" />
                <Bar dataKey="variance" name="Variance" radius={[0, 2, 2, 0]}>
                  {data.variance.map((d, i) => <Cell key={i} fill={d.variance >= 0 ? GREEN : RED} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  )
}
