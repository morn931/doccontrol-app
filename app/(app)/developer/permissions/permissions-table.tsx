'use client'

export type Access = 'yes' | 'no' | 'locked-on' | 'locked-off'

export interface PermRow {
  label:   string
  note?:   string
  adm:  Access
  dc:   Access
  rev:  Access
  em:   Access
  pm:   Access
  ven:  Access
  dev:  Access
}

export interface Section {
  title: string
  rows:  PermRow[]
}

function Checkbox({ value }: { value: Access }) {
  const locked = value === 'locked-on' || value === 'locked-off'
  const checked = value === 'yes' || value === 'locked-on'

  if (checked) {
    return (
      <svg viewBox="0 0 20 20" className={`w-5 h-5 mx-auto ${locked ? 'opacity-30' : ''}`}>
        <rect x="2" y="2" width="16" height="16" rx="4" fill="#0d9488" />
        <path d="M6 10l2.5 2.5L14 7.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" className={`w-5 h-5 mx-auto ${locked ? 'opacity-30' : ''}`}>
      <rect x="2" y="2" width="16" height="16" rx="4" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
    </svg>
  )
}

const COLS: { key: keyof Omit<PermRow, 'label' | 'note'>; label: string }[] = [
  { key: 'adm', label: 'Admin' },
  { key: 'dc',  label: 'Doc Controller' },
  { key: 'rev', label: 'Reviewer' },
  { key: 'em',  label: 'Eng Manager' },
  { key: 'pm',  label: 'Project Manager' },
  { key: 'ven', label: 'Vendor' },
  { key: 'dev', label: 'Developer' },
]

export function PermissionsTable({ sections }: { sections: Section[] }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden text-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-4 py-3 font-medium text-slate-600 w-64">Feature / Action</th>
            {COLS.map(c => (
              <th key={c.key} className="text-center px-2 py-3 font-medium text-slate-600 text-xs w-24">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map(section => (
            <>
              <tr key={section.title} className="bg-slate-50 border-t border-b border-slate-200">
                <td colSpan={8} className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  {section.title}
                </td>
              </tr>
              {section.rows.map((row, i) => (
                <tr key={row.label + i} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-3 text-slate-700">
                    {row.label}
                    {row.note && <p className="text-xs text-slate-400 mt-0.5">{row.note}</p>}
                  </td>
                  {COLS.map(c => (
                    <td key={c.key} className="text-center px-2 py-3">
                      <Checkbox value={row[c.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}
