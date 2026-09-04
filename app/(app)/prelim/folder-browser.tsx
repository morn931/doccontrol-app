'use client'
import { useEffect, useState } from 'react'
import { Folder, FileText, ArrowLeft, Loader2 } from 'lucide-react'

export type BrowseItem = { name: string; isFolder: boolean; size: number; webUrl: string }

// Browse the source library live (no download). Two uses: picking the session's folder
// when a session is opened, and ticking files to pull into an open session.
export default function FolderBrowser({ site, library, path, onPath, selectable, selected, onToggle, onSelectAll }: {
  site?: string; library?: string; path: string; onPath: (p: string) => void
  selectable?: boolean; selected?: Set<string>; onToggle?: (item: BrowseItem) => void; onSelectAll?: (items: BrowseItem[]) => void
}) {
  const [items, setItems] = useState<BrowseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let dead = false
    setLoading(true); setError('')
    const q = new URLSearchParams({ path }); if (site) q.set('site', site); if (library) q.set('library', library)
    fetch(`/api/prelim/browse?${q}`).then(async r => { const d = await r.json(); if (dead) return; if (!r.ok) setError(d.error ?? 'Could not list the folder'); else setItems(d.items ?? []) })
      .catch(e => !dead && setError(e.message)).finally(() => !dead && setLoading(false))
    return () => { dead = true }
  }, [site, library, path])
  const files = items.filter(i => !i.isFolder)
  const up = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
        {path ? <button type="button" onClick={() => onPath(up)} className="inline-flex items-center gap-1 text-teal-700 hover:underline"><ArrowLeft className="h-3 w-3" /> up</button> : null}
        <span className="font-mono truncate">{library ?? 'COLAB'}/{path || ''}</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto" />}
        {selectable && files.length > 0 && onSelectAll && <button type="button" onClick={() => onSelectAll(files)} className="ml-auto text-teal-700 hover:underline">select all {files.length} files</button>}
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      <ul className="max-h-80 overflow-auto divide-y divide-slate-100 text-sm">
        {items.map(i => (
          <li key={i.webUrl} className="flex items-center gap-2 px-3 py-1.5">
            {i.isFolder
              ? <button type="button" onClick={() => onPath(path ? `${path}/${i.name}` : i.name)} className="flex items-center gap-2 text-slate-800 hover:text-teal-700"><Folder className="h-4 w-4 text-amber-500" />{i.name}</button>
              : <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                  {selectable && <input type="checkbox" checked={selected?.has(i.webUrl) ?? false} onChange={() => onToggle?.(i)} />}
                  <FileText className="h-4 w-4 text-slate-400" />{i.name}
                  <span className="text-xs text-slate-400">{(i.size / 1024 / 1024).toFixed(1)} MB</span>
                </label>}
          </li>
        ))}
        {!loading && !items.length && !error && <li className="px-3 py-3 text-xs text-slate-400">Empty folder.</li>}
      </ul>
    </div>
  )
}
