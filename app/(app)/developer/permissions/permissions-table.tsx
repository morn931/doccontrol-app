'use client'

import { useTransition, useState, useCallback } from 'react'
import { updatePermission } from './actions'

export type Access = 'yes' | 'no' | 'locked-on' | 'locked-off'

export interface PermRow {
  label:      string
  note?:      string
  featureKey: string | null  // null = hardcoded, not toggleable
  adm: Access; dc: Access; rev: Access; em: Access; pm: Access; ven: Access; dev: Access
}

export interface Section { title: string; rows: PermRow[] }

type ColKey = 'adm' | 'dc' | 'rev' | 'em' | 'pm' | 'ven' | 'dev'

const COLS: { key: ColKey; dbRole: string; label: string }[] = [
  { key: 'adm', dbRole: 'admin',               label: 'Admin' },
  { key: 'dc',  dbRole: 'document_controller',  label: 'Doc Controller' },
  { key: 'rev', dbRole: 'reviewer',             label: 'Reviewer' },
  { key: 'em',  dbRole: 'engineering_manager',  label: 'Eng Manager' },
  { key: 'pm',  dbRole: 'project_manager',      label: 'Project Manager' },
  { key: 'ven', dbRole: 'vendor',               label: 'Vendor' },
  { key: 'dev', dbRole: 'developer',            label: 'Developer' },
]

function CheckCell({
  access, featureKey, dbRole, onToggle, pending,
}: {
  access: Access
  featureKey: string | null
  dbRole: string
  onToggle: (fk: string, role: string, next: boolean) => void
  pending: boolean
}) {
  const locked = featureKey === null || access === 'locked-on' || access === 'locked-off' || dbRole === 'developer'
  const checked = access === 'yes' || access === 'locked-on'

  if (locked) {
    return checked ? (
      <svg viewBox="0 0 20 20" className="w-5 h-5 mx-auto opacity-30">
        <rect x="2" y="2" width="16" height="16" rx="4" fill="#0d9488" />
        <path d="M6 10l2.5 2.5L14 7.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ) : (
      <svg viewBox="0 0 20 20" className="w-5 h-5 mx-auto opacity-20">
        <rect x="2" y="2" width="16" height="16" rx="4" fill="none" stroke="#e2e8f0" strokeWidth="1.5" />
      </svg>
    )
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => onToggle(featureKey!, dbRole, !checked)}
      className={`mx-auto block rounded transition-opacity ${pending ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:opacity-75'}`}
      title={checked ? 'Click to revoke' : 'Click to grant'}
    >
      {checked ? (
        <svg viewBox="0 0 20 20" className="w-5 h-5">
          <rect x="2" y="2" width="16" height="16" rx="4" fill="#0d9488" />
          <path d="M6 10l2.5 2.5L14 7.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="w-5 h-5">
          <rect x="2" y="2" width="16" height="16" rx="4" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
        </svg>
      )}
    </button>
  )
}

export function PermissionsTable({ sections: initial }: { sections: Section[] }) {
  const [sections, setSections] = useState(initial)
  const [, startTransition] = useTransition()
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const handleToggle = useCallback((featureKey: string, dbRole: string, next: boolean) => {
    const colKey = COLS.find(c => c.dbRole === dbRole)?.key
    if (!colKey) return
    setPendingKey(`${featureKey}:${dbRole}`)

    setSections(prev => prev.map(sec => ({
      ...sec,
      rows: sec.rows.map(row =>
        row.featureKey !== featureKey ? row : { ...row, [colKey]: next ? 'yes' : 'no' } as PermRow
      ),
    })))

    startTransition(async () => {
      try {
        await updatePermission(featureKey, dbRole, next)
      } catch {
        setSections(initial)
      } finally {
        setPendingKey(null)
      }
    })
  }, [initial])

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden text-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-4 py-3 text-left font-semibold text-slate-700 text-xs">Feature / Action</th>
            {COLS.map(c => (
              <th key={c.key} className="px-2 py-3 text-center font-semibold text-slate-700 text-xs w-24">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map(section => (
            <>
              <tr key={section.title} className="bg-slate-50/70">
                <td colSpan={8} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider border-t border-b border-slate-200">
                  {section.title}
                </td>
              </tr>
              {section.rows.map((row, i) => (
                <tr key={row.label + i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="text-slate-800">{row.label}</span>
                    {row.note && <p className="text-[11px] text-slate-400 mt-0.5">{row.note}</p>}
                  </td>
                  {COLS.map(c => (
                    <td key={c.key} className="px-2 py-2.5 text-center">
                      <CheckCell
                        access={row[c.key]}
                        featureKey={row.featureKey}
                        dbRole={c.dbRole}
                        onToggle={handleToggle}
                        pending={pendingKey === `${row.featureKey}:${c.dbRole}`}
                      />
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
