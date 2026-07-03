'use client'

// ─── PHASE 0 SPIKE — in-app PDF markup (PDF.js + fabric overlay + pdf-lib) ────
// Proof only: load a PDF, draw text/ink/shapes/highlight over it, capture every
// mark-up as STRUCTURED metadata (the real prize), and re-flatten to a PDF so the
// SharePoint deliverable still shows the mark-ups. Not wired to any batch yet.

import { useEffect, useRef, useState } from 'react'

type Tool = 'select' | 'pen' | 'text' | 'rect' | 'highlight'
type PageAnno = { json: any; width: number; height: number }

const SCALE = 1.4 // display render scale

export default function MarkupSpikePage() {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const fabCanvasRef = useRef<HTMLCanvasElement>(null)
  const fabRef = useRef<any>(null)          // fabric.Canvas
  const fabricLibRef = useRef<any>(null)    // fabric module
  const pdfDocRef = useRef<any>(null)       // pdfjs document
  const pdfBytesRef = useRef<Uint8Array | null>(null)
  const annoRef = useRef<Record<number, PageAnno>>({})

  const [ready, setReady] = useState(false)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#e11d48')
  const [meta, setMeta] = useState<any[] | null>(null)
  const [status, setStatus] = useState('Load a PDF to begin.')

  // Load fabric once (client-only)
  useEffect(() => {
    let disposed = false
    ;(async () => {
      const fabric = await import('fabric')
      if (disposed) return
      fabricLibRef.current = fabric
      setReady(true)
    })()
    return () => { disposed = true; fabRef.current?.dispose?.() }
  }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('Loading PDF…')
    const buf = new Uint8Array(await file.arrayBuffer())
    pdfBytesRef.current = buf.slice(0)                        // keep a copy for pdf-lib
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    const pdf = await pdfjs.getDocument({ data: buf }).promise
    pdfDocRef.current = pdf
    annoRef.current = {}
    setNumPages(pdf.numPages)
    setPage(1)
    await renderPage(1)
    setStatus(`Loaded ${pdf.numPages} page(s). Draw away.`)
  }

  function captureCurrentPage() {
    const fab = fabRef.current
    if (!fab) return
    annoRef.current[page] = { json: fab.toJSON(), width: fab.width, height: fab.height }
  }

  async function renderPage(num: number) {
    const pdf = pdfDocRef.current
    const fabric = fabricLibRef.current
    if (!pdf || !fabric) return
    const pg = await pdf.getPage(num)
    const viewport = pg.getViewport({ scale: SCALE })
    const pdfCanvas = pdfCanvasRef.current!
    pdfCanvas.width = viewport.width
    pdfCanvas.height = viewport.height
    await pg.render({ canvasContext: pdfCanvas.getContext('2d')!, viewport }).promise

    // (Re)build the fabric overlay at matching size
    fabRef.current?.dispose?.()
    const fab = new fabric.Canvas(fabCanvasRef.current!, {
      width: viewport.width, height: viewport.height, backgroundColor: undefined,
    })
    fabRef.current = fab
    // fabric wraps the <canvas> in a .canvas-container div; force it to overlay the
    // PDF canvas exactly.
    if (fab.wrapperEl) {
      fab.wrapperEl.style.position = 'absolute'
      fab.wrapperEl.style.top = '0'
      fab.wrapperEl.style.left = '0'
    }
    if (annoRef.current[num]) await fab.loadFromJSON(annoRef.current[num].json)
    fab.renderAll()
    wireTools(fab)
    applyTool(fab, tool, color)
  }

  function wireTools(fab: any) {
    const fabric = fabricLibRef.current
    fab.on('mouse:down', (opt: any) => {
      const t = toolRef.current
      if (t !== 'text' && t !== 'rect' && t !== 'highlight') return
      if (opt.target) return
      const p = fab.getPointer(opt.e)
      if (t === 'text') {
        const it = new fabric.IText('Text', { left: p.x, top: p.y, fontSize: 18, fill: colorRef.current })
        fab.add(it); fab.setActiveObject(it); it.enterEditing()
      } else {
        const isHl = t === 'highlight'
        const r = new fabric.Rect({
          left: p.x, top: p.y, width: 140, height: isHl ? 22 : 80,
          fill: isHl ? colorRef.current + '55' : 'transparent',
          stroke: isHl ? undefined : colorRef.current, strokeWidth: isHl ? 0 : 2,
        })
        fab.add(r); fab.setActiveObject(r)
      }
      fab.renderAll()
    })
  }

  // refs so the fabric event handler always sees the latest tool/colour
  const toolRef = useRef(tool); const colorRef = useRef(color)
  useEffect(() => { toolRef.current = tool; if (fabRef.current) applyTool(fabRef.current, tool, color) }, [tool, color])
  useEffect(() => { colorRef.current = color }, [color])

  function applyTool(fab: any, t: Tool, c: string) {
    const fabric = fabricLibRef.current
    fab.isDrawingMode = t === 'pen'
    if (t === 'pen') {
      const brush = new fabric.PencilBrush(fab)
      brush.color = c; brush.width = 2.5
      fab.freeDrawingBrush = brush
    }
    fab.selection = t === 'select'
    fab.forEachObject((o: any) => { o.selectable = t === 'select'; o.evented = t === 'select' })
    fab.renderAll()
  }

  async function goPage(next: number) {
    if (next < 1 || next > numPages) return
    captureCurrentPage()
    setPage(next)
    await renderPage(next)
  }

  function deleteSelected() {
    const fab = fabRef.current
    fab?.getActiveObjects().forEach((o: any) => fab.remove(o))
    fab?.discardActiveObject(); fab?.renderAll()
  }

  // ── Structured metadata (the real prize) ───────────────────────────────────
  function exportMetadata() {
    captureCurrentPage()
    const out: any[] = []
    for (const [pg, a] of Object.entries(annoRef.current)) {
      const objs = (a as PageAnno).json?.objects ?? []
      for (const o of objs) {
        const kind = o.type === 'path' ? 'ink'
          : o.type === 'i-text' || o.type === 'text' ? 'text'
          : o.type === 'rect' ? (o.strokeWidth ? 'rect' : 'highlight') : o.type
        out.push({
          page: Number(pg), kind,
          text: o.text ?? null,
          colour: o.stroke || o.fill || null,
          geometry: { left: Math.round(o.left), top: Math.round(o.top), width: Math.round((o.width ?? 0) * (o.scaleX ?? 1)), height: Math.round((o.height ?? 0) * (o.scaleY ?? 1)), angle: o.angle ?? 0 },
        })
      }
    }
    setMeta(out)
    setStatus(`Captured ${out.length} mark-up(s) as structured metadata.`)
  }

  // ── Flatten to PDF (stamp each page's overlay as a high-res image) ──────────
  async function flattenDownload() {
    captureCurrentPage()
    if (!pdfBytesRef.current) return
    setStatus('Flattening mark-ups into the PDF…')
    const fabric = fabricLibRef.current
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.load(pdfBytesRef.current)
    const pages = doc.getPages()

    for (const [pgStr, a] of Object.entries(annoRef.current)) {
      const anno = a as PageAnno
      if (!anno.json?.objects?.length) continue
      const idx = Number(pgStr) - 1
      const pdfPage = pages[idx]
      if (!pdfPage) continue
      // Render this page's overlay to a transparent PNG at 2× for crispness
      const offEl = document.createElement('canvas')
      offEl.width = anno.width; offEl.height = anno.height
      const off = new fabric.StaticCanvas(offEl, { width: anno.width, height: anno.height, backgroundColor: undefined })
      await off.loadFromJSON(anno.json)
      off.renderAll()
      const dataUrl = off.toDataURL({ format: 'png', multiplier: 2 })
      off.dispose()
      const png = await doc.embedPng(dataUrl)
      const { width, height } = pdfPage.getSize()
      pdfPage.drawImage(png, { x: 0, y: 0, width, height })
    }
    const bytes = await doc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'markup-flattened.pdf'; link.click()
    URL.revokeObjectURL(url)
    setStatus('Flattened PDF downloaded — mark-ups baked in.')
  }

  const Btn = ({ t, label }: { t: Tool; label: string }) => (
    <button onClick={() => setTool(t)}
      className={`px-3 py-1.5 rounded-md text-sm font-medium border ${tool === t ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">In-app Markup — Phase 0 spike</h1>
        <p className="text-slate-500 text-sm mt-1">
          Proof of concept: PDF.js render · fabric overlay · structured-metadata capture · pdf-lib flatten. Not wired to reviews yet.
        </p>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-2">
        <input type="file" accept="application/pdf" onChange={onFile} disabled={!ready} className="text-sm" />
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <Btn t="select" label="Select" />
        <Btn t="pen" label="✏ Pen" />
        <Btn t="text" label="T Text" />
        <Btn t="rect" label="▭ Box" />
        <Btn t="highlight" label="▉ Highlight" />
        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-8 w-8 rounded border border-slate-300" />
        <button onClick={deleteSelected} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50">Delete</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={exportMetadata} className="px-3 py-1.5 rounded-md text-sm font-medium bg-teal-600 text-white hover:bg-teal-700">Export metadata</button>
        <button onClick={flattenDownload} className="px-3 py-1.5 rounded-md text-sm font-medium bg-navy-700 text-white hover:bg-navy-800">Flatten &amp; download PDF</button>
      </div>

      {numPages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button onClick={() => goPage(page - 1)} disabled={page <= 1} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-40">‹ Prev</button>
          <span>Page {page} / {numPages}</span>
          <button onClick={() => goPage(page + 1)} disabled={page >= numPages} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-40">Next ›</button>
        </div>
      )}

      <p className="text-xs text-slate-500">{status}</p>

      <div className="card p-4 overflow-auto">
        <div className="relative inline-block shadow-sm">
          <canvas ref={pdfCanvasRef} className="block" />
          <canvas ref={fabCanvasRef} className="absolute top-0 left-0" />
        </div>
      </div>

      {meta && (
        <div className="card p-4">
          <h2 className="font-semibold text-slate-900 mb-2">Structured metadata ({meta.length}) — this is what we&apos;d store &amp; feed the transmittal</h2>
          <pre className="text-xs bg-slate-50 border border-slate-100 rounded p-3 overflow-auto max-h-80">{JSON.stringify(meta, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
