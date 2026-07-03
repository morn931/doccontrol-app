'use client'

// ─── PHASE 0 SPIKE (v2) — in-app PDF markup (PDF.js + fabric + pdf-lib) ───────
// Continuous scroll · bordered pages · pen/text/shapes/highlight/image · undo ·
// flatten to PDF. Text comments are captured silently (for the transmittal);
// everything else is baked into the PDF on save. Not wired to reviews yet.

import { useEffect, useRef, useState } from 'react'

type Tool = 'select' | 'pen' | 'text' | 'shape' | 'highlight'
type Shape = 'box' | 'circle' | 'line' | 'arrow'

const SCALE = 1.4

export default function MarkupSpikePage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  const fabricLibRef = useRef<any>(null)
  const pdfDocRef = useRef<any>(null)
  const pdfBytesRef = useRef<Uint8Array | null>(null)
  const fabsRef = useRef<any[]>([])
  const wrappersRef = useRef<HTMLElement[]>([])
  const undoRef = useRef<{ fab: any; obj: any }[]>([])

  const [ready, setReady] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<Shape>('box')
  const [color, setColor] = useState('#e11d48')
  const [status, setStatus] = useState('Load a PDF to begin.')

  const toolRef = useRef(tool); const colorRef = useRef(color); const shapeRef = useRef(shape)
  useEffect(() => { toolRef.current = tool; applyToolAll() }, [tool, color])
  useEffect(() => { colorRef.current = color }, [color])
  useEffect(() => { shapeRef.current = shape }, [shape])

  useEffect(() => {
    let dead = false
    ;(async () => { const f = await import('fabric'); if (!dead) { fabricLibRef.current = f; setReady(true) } })()
    return () => { dead = true; fabsRef.current.forEach(f => f.dispose?.()) }
  }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setStatus('Loading PDF…')
    const buf = new Uint8Array(await file.arrayBuffer())
    pdfBytesRef.current = buf.slice(0)
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    const pdf = await pdfjs.getDocument({ data: buf }).promise
    pdfDocRef.current = pdf

    const fabric = fabricLibRef.current
    fabsRef.current.forEach(f => f.dispose?.())
    fabsRef.current = []; wrappersRef.current = []; undoRef.current = []
    const container = containerRef.current!; container.innerHTML = ''

    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p)
      const vp = pg.getViewport({ scale: SCALE })
      const wrap = document.createElement('div')
      wrap.className = 'relative mx-auto mb-6 border-2 border-slate-500 shadow-lg bg-white'
      wrap.style.width = `${vp.width}px`; wrap.style.height = `${vp.height}px`
      const pc = document.createElement('canvas'); pc.width = vp.width; pc.height = vp.height; pc.style.display = 'block'
      const fc = document.createElement('canvas')
      wrap.appendChild(pc); wrap.appendChild(fc); container.appendChild(wrap)
      await pg.render({ canvasContext: pc.getContext('2d')!, viewport: vp }).promise
      const fab = new fabric.Canvas(fc, { width: vp.width, height: vp.height, backgroundColor: undefined })
      if (fab.wrapperEl) { fab.wrapperEl.style.position = 'absolute'; fab.wrapperEl.style.top = '0'; fab.wrapperEl.style.left = '0' }
      wireFab(fab)
      fabsRef.current.push(fab); wrappersRef.current.push(wrap)
    }
    applyToolAll()
    setStatus(`Loaded ${pdf.numPages} page(s). Scroll to move through the document.`)
  }

  function wireFab(fab: any) {
    const fabric = fabricLibRef.current
    fab.on('object:added', (e: any) => { if (e.target?._skipHistory) return; undoRef.current.push({ fab, obj: e.target }) })
    fab.on('mouse:down', (opt: any) => {
      const t = toolRef.current
      if ((t !== 'text' && t !== 'shape') || opt.target) return
      const p = fab.getScenePoint ? fab.getScenePoint(opt.e) : fab.getPointer(opt.e)
      if (t === 'text') {
        const it = new fabric.IText('', { left: p.x, top: p.y, fontSize: 26, fill: colorRef.current, editingBorderColor: '#0ea5e9' })
        fab.add(it); fab.setActiveObject(it); it.enterEditing()
        it.on('editing:exited', () => { if (!String(it.text ?? '').trim()) fab.remove(it) })
      } else {
        insertShape(fab, shapeRef.current, p, colorRef.current)
      }
      fab.renderAll()
    })
  }

  function insertShape(fab: any, kind: Shape, p: { x: number; y: number }, c: string) {
    const fabric = fabricLibRef.current
    let obj: any
    if (kind === 'box') obj = new fabric.Rect({ left: p.x, top: p.y, width: 150, height: 90, fill: 'transparent', stroke: c, strokeWidth: 2 })
    else if (kind === 'circle') obj = new fabric.Ellipse({ left: p.x, top: p.y, rx: 70, ry: 45, fill: 'transparent', stroke: c, strokeWidth: 2 })
    else if (kind === 'line') obj = new fabric.Line([p.x, p.y, p.x + 150, p.y], { stroke: c, strokeWidth: 3 })
    else { // arrow = line + head, grouped
      const line = new fabric.Line([0, 0, 140, 0], { stroke: c, strokeWidth: 3 })
      const head = new fabric.Triangle({ left: 140, top: 0, originX: 'center', originY: 'center', angle: 90, width: 16, height: 18, fill: c })
      obj = new fabric.Group([line, head], { left: p.x, top: p.y })
    }
    fab.add(obj); fab.setActiveObject(obj)
  }

  function applyToolAll() {
    const fabric = fabricLibRef.current
    if (!fabric) return
    for (const fab of fabsRef.current) {
      fab.isDrawingMode = tool === 'pen' || tool === 'highlight'
      if (tool === 'pen') { const b = new fabric.PencilBrush(fab); b.color = color; b.width = 2.5; fab.freeDrawingBrush = b }
      if (tool === 'highlight') { const b = new fabric.PencilBrush(fab); b.color = color + '55'; b.width = 16; fab.freeDrawingBrush = b }
      fab.selection = tool === 'select'
      fab.forEachObject((o: any) => { o.selectable = tool === 'select'; o.evented = tool === 'select' })
      fab.renderAll()
    }
  }

  function activeFab() {
    const cy = window.innerHeight / 2
    let best = 0, bestDist = Infinity
    wrappersRef.current.forEach((w, i) => { const r = w.getBoundingClientRect(); const d = Math.abs(r.top + r.height / 2 - cy); if (d < bestDist) { bestDist = d; best = i } })
    return fabsRef.current[best]
  }

  async function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    const fabric = fabricLibRef.current
    const url = URL.createObjectURL(f)
    const img = await fabric.FabricImage.fromURL(url)
    const s = Math.min(1, 320 / (img.width || 320))
    img.set({ left: 40, top: 40, scaleX: s, scaleY: s })
    const fab = activeFab()
    fab.add(img); fab.setActiveObject(img); fab.renderAll()
    e.target.value = ''
  }

  function undo() {
    const entry = undoRef.current.pop()
    if (entry) { entry.fab.remove(entry.obj); entry.fab.discardActiveObject(); entry.fab.renderAll() }
  }

  function deleteSelected() {
    const fab = fabsRef.current.find((f: any) => f.getActiveObjects().length)
    fab?.getActiveObjects().forEach((o: any) => fab.remove(o))
    fab?.discardActiveObject(); fab?.renderAll()
  }

  async function flattenDownload() {
    if (!pdfBytesRef.current) return
    setStatus('Flattening mark-ups into the PDF…')
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.load(pdfBytesRef.current)
    const pages = doc.getPages()
    for (let i = 0; i < fabsRef.current.length; i++) {
      const fab = fabsRef.current[i]
      if (!fab.getObjects().length || !pages[i]) continue
      const png = await doc.embedPng(fab.toDataURL({ format: 'png', multiplier: 2 }))
      const { width, height } = pages[i].getSize()
      pages[i].drawImage(png, { x: 0, y: 0, width, height })
    }
    const bytes = await doc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'markup-flattened.pdf'; a.click()
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
        <p className="text-slate-500 text-sm mt-1">Proof of concept — scroll the document; pen · text · shapes · highlight · image · undo · flatten. Not wired to reviews yet.</p>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-2 sticky top-2 z-10">
        <input ref={fileRef} type="file" accept="application/pdf" onChange={onFile} disabled={!ready} className="text-sm" />
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <Btn t="select" label="Select" />
        <Btn t="pen" label="✏ Pen" />
        <Btn t="text" label="T Text" />
        <div className="flex items-center">
          <button onClick={() => setTool('shape')}
            className={`px-3 py-1.5 rounded-l-md text-sm font-medium border ${tool === 'shape' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
            ◆ Shape
          </button>
          <select value={shape} onChange={e => { setShape(e.target.value as Shape); setTool('shape') }}
            className="rounded-r-md border border-l-0 border-slate-300 text-sm py-1.5 px-1 bg-white">
            <option value="box">Box</option>
            <option value="circle">Circle</option>
            <option value="line">Line</option>
            <option value="arrow">Arrow</option>
          </select>
        </div>
        <Btn t="highlight" label="▉ Highlight" />
        <button onClick={() => imgInputRef.current?.click()} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50">🖼 Image</button>
        <input ref={imgInputRef} type="file" accept="image/*" onChange={onImage} className="hidden" />
        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-8 w-8 rounded border border-slate-300" />
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={undo} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50">↶ Undo</button>
        <button onClick={deleteSelected} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50">Delete</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={flattenDownload} className="px-3 py-1.5 rounded-md text-sm font-medium bg-navy-700 text-white hover:bg-navy-800">Flatten &amp; download PDF</button>
      </div>

      <p className="text-xs text-slate-500">{status}</p>

      <div ref={containerRef} className="rounded-lg bg-slate-100 p-6 max-h-[78vh] overflow-auto" />
    </div>
  )
}
