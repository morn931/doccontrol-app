'use client'
import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, ZoomIn, ZoomOut } from 'lucide-react'

/**
 * Read-only in-app PDF viewer (PDF.js), for pages that only need to SHOW a document.
 *
 * WHY THIS EXISTS. The Aconex viewer used a native `<object type="application/pdf">`,
 * which hands rendering to whatever PDF plugin the browser has. With the Adobe Acrobat
 * extension set to open PDFs, Chrome's built-in viewer is disabled inside embeds and
 * the object silently shows its fallback — "No preview available" for a document that
 * streamed perfectly (found 2026-09-08 on 6105AK124-9134-CTMP-0015). Drawing the pages
 * ourselves, the way the review mark-up viewer already does, takes the plugin out of it.
 *
 * Fetches `src` (same-origin, session cookies ride along), renders every page to a
 * canvas at 2× for crisp zoom. Reports a distinct message for a 404 (no file behind
 * the link) versus any other failure, so a reserved placeholder reads as what it is.
 */
export default function PdfViewer({ src, className }: { src: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'nofile' | 'error'>('loading')
  const [detail, setDetail] = useState<string>('')
  const [pages, setPages] = useState(0)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let dead = false
    const container = containerRef.current
    ;(async () => {
      setStatus('loading'); setDetail(''); setPages(0)
      try {
        const res = await fetch(src, { cache: 'no-store' })
        if (res.status === 404) { setStatus('nofile'); return }
        if (!res.ok) { setStatus('error'); setDetail(`HTTP ${res.status}`); return }
        const buf = new Uint8Array(await res.arrayBuffer())
        if (dead || !container) return
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const pdf = await pdfjs.getDocument({ data: buf }).promise
        if (dead) return
        container.innerHTML = ''
        const MAX_W = 1400
        const RENDER_MULT = 2
        for (let p = 1; p <= pdf.numPages; p++) {
          const pg = await pdf.getPage(p)
          const base = pg.getViewport({ scale: 1 })
          const scale = Math.min(1.5, MAX_W / base.width)
          const vp = pg.getViewport({ scale })
          const rvp = pg.getViewport({ scale: scale * RENDER_MULT })
          const wrap = document.createElement('div')
          wrap.className = 'pdfv-page mx-auto mb-4 bg-white shadow-md border border-slate-300'
          wrap.style.width = `${vp.width}px`
          const c = document.createElement('canvas')
          c.width = rvp.width; c.height = rvp.height
          c.style.width = '100%'; c.style.display = 'block'
          wrap.appendChild(c); container.appendChild(wrap)
          await pg.render({ canvasContext: c.getContext('2d')!, viewport: rvp }).promise
          if (dead) return
          setPages(p)
        }
        setStatus('ready')
      } catch (e) {
        if (dead) return
        setStatus('error'); setDetail(e instanceof Error ? e.message : 'render failed')
      }
    })()
    return () => { dead = true }
  }, [src])

  // CSS zoom scales the already-rendered pages; no re-render needed.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('.pdfv-page').forEach(w => {
      const base = w.style.width ? parseFloat(w.style.width) : 0
      if (base) w.style.transform = `scale(${zoom})`
      w.style.transformOrigin = 'top center'
      w.style.marginBottom = `${16 * zoom}px`
    })
  }, [zoom, pages])

  return (
    <div className={`relative flex flex-col ${className ?? ''}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
        <button type="button" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="rounded p-1 hover:bg-slate-200" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} className="rounded p-1 hover:bg-slate-200" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
        <span className="ml-auto">
          {status === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {pages ? `rendering page ${pages}…` : 'loading…'}</span>}
          {status === 'ready' && `${pages} page${pages === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="flex-1 overflow-auto bg-slate-100 p-4">
        {status === 'nofile' && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center p-8">
            <FileText className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">No file behind this document</p>
            <p className="text-xs text-slate-400 max-w-sm">
              Aconex has no file for this entry — typically a <strong>reserved placeholder</strong> that has not been issued yet.
            </p>
          </div>
        )}
        {status === 'error' && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center p-8">
            <FileText className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">Could not display this document</p>
            <p className="text-xs text-slate-400 max-w-sm">{detail || 'Unknown error'}. Use <strong>Download</strong> above to open it directly.</p>
          </div>
        )}
        <div ref={containerRef} className={status === 'nofile' || status === 'error' ? 'hidden' : ''} />
      </div>
    </div>
  )
}
