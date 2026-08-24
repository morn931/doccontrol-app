'use client'

// The originator's comment checklist (Wes's request): the flattened document beside a tickable list
// of every reviewer's comments. Click an item → jump to the mark; tick it → resolved. Fed by the
// document-version aggregation endpoint; resolves via the per-review-task PATCH.
import { useEffect, useRef, useState } from 'react'
import PdfMarkup from './pdf-markup'

type Comment = {
  id: string; page: number; text: string; kind: string
  x: number; y: number; pw: number; ph: number; color?: string
  review_task_id: string; reviewer: string; resolved?: boolean
}

export default function CommentChecklist({ documentVersionId, fileSrc, fileName }: {
  documentVersionId: string
  fileSrc: string     // the flattened PDF to view, e.g. /api/documents/<dv.id>/file
  fileName?: string
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const apiRef = useRef<{ jumpTo: (c: any) => void } | null>(null)

  useEffect(() => {
    let dead = false
    setLoading(true)
    fetch(`/api/documents/${documentVersionId}/markups`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => { if (!dead) setComments(Array.isArray(d.comments) ? d.comments : []) })
      .catch(() => { if (!dead) setComments([]) })
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [documentVersionId])

  async function toggle(c: Comment) {
    const resolved = !c.resolved
    setBusy(c.id)
    setComments((cs) => cs.map((x) => x.id === c.id ? { ...x, resolved } : x)) // optimistic
    try {
      const r = await fetch(`/api/reviews/${c.review_task_id}/markup`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId: c.id, resolved }),
      })
      if (!r.ok) throw new Error()
    } catch {
      setComments((cs) => cs.map((x) => x.id === c.id ? { ...x, resolved: !resolved } : x)) // revert
    } finally { setBusy(null) }
  }

  const total = comments.length
  const done = comments.filter((c) => c.resolved).length
  const byPage = comments.reduce((a: Record<number, Comment[]>, c) => { (a[c.page] ||= []).push(c); return a }, {})

  return (
    <div className="flex gap-4">
      <div className="flex-1 min-w-0">
        <PdfMarkup src={fileSrc} fileName={fileName} readOnly exposeApi={(api) => { apiRef.current = api }} />
      </div>
      <aside className="w-96 shrink-0 self-start sticky top-2 max-h-[85vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <div className="sticky top-0 bg-slate-800 text-white px-3 py-2 text-sm font-semibold flex justify-between">
          <span>Reviewer comments</span>
          <span className="text-slate-300 tabular-nums">{done} of {total} resolved</span>
        </div>
        {loading && <p className="p-3 text-xs text-slate-500">Loading comments…</p>}
        {!loading && total === 0 && <p className="p-3 text-xs text-slate-500">No reviewer comments on this document.</p>}
        {Object.entries(byPage).map(([pg, list]) => (
          <div key={pg} className="border-b border-slate-100">
            <div className="px-3 py-1.5 bg-slate-50 text-xs font-semibold text-slate-600">
              Page {pg} <span className="text-slate-400">({list.length})</span>
            </div>
            {list.map((c) => (
              <div key={c.id} className={`flex gap-2 px-3 py-2 text-sm ${c.resolved ? 'bg-emerald-50/60' : 'hover:bg-sky-50'}`}>
                <input type="checkbox" checked={!!c.resolved} disabled={busy === c.id}
                  onChange={() => toggle(c)} className="mt-1 shrink-0" title="Mark resolved" />
                <button onClick={() => apiRef.current?.jumpTo(c)} className="min-w-0 flex-1 text-left">
                  <div className={c.resolved ? 'line-through text-slate-400' : 'text-slate-700'}>{c.text}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color ?? '#64748b' }} />
                    {c.reviewer}{c.kind !== 'text' ? ` · ${c.kind}` : ''}
                  </div>
                </button>
              </div>
            ))}
          </div>
        ))}
      </aside>
    </div>
  )
}
