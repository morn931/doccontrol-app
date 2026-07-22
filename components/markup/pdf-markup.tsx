'use client'

// Reusable in-app PDF markup editor (PDF.js render + fabric overlay + pdf-lib flatten).
// Loads a PDF from `src` (a URL that streams the bytes) or a local file if none given.
// Phase 1: view + annotate + flatten-download. Save-to-SharePoint (Graph) is Phase 3.

import { useEffect, useRef, useState } from 'react'

type Tool = 'select' | 'pen' | 'text' | 'shape' | 'highlight'
type Shape = 'box' | 'circle' | 'line' | 'arrow'

const SCALE = 1.4
// Browsers cap a <canvas> at 16384px per side — a huge (e.g. 179"×113") drawing at
// SCALE 1.4 overflows that and renders blank. Clamp the per-page scale so neither
// canvas dimension exceeds this; normal documents are unaffected.
const MAX_DIM = 10000

export default function PdfMarkup({ src, fileName, reviewTaskId, initialColor }: { src?: string; fileName?: string; reviewTaskId?: string; initialColor?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  const fabricLibRef = useRef<any>(null)
  const pdfBytesRef = useRef<Uint8Array | null>(null)
  const fabsRef = useRef<any[]>([])
  const wrappersRef = useRef<HTMLElement[]>([])
  const undoRef = useRef<{ fab: any; obj: any }[]>([])
  const skipHistoryRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<Shape>('box')
  const [color, setColor] = useState(initialColor ?? '#e11d48')
  const [status, setStatus] = useState(src ? 'Loading document…' : 'Load a PDF to begin.')
  const [fullscreen, setFullscreen] = useState(false)

  // Esc leaves full-screen review mode.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const toolRef = useRef(tool); const colorRef = useRef(color); const shapeRef = useRef(shape)
  useEffect(() => { toolRef.current = tool; applyToolAll() }, [tool, color])
  useEffect(() => { colorRef.current = color }, [color])
  useEffect(() => { shapeRef.current = shape }, [shape])

  useEffect(() => {
    let dead = false
    ;(async () => {
      const f = await import('fabric'); if (dead) return
      fabricLibRef.current = f; setReady(true)
      if (src) {
        try {
          const res = await fetch(src)
          if (!res.ok) { setStatus('Could not load the document from SharePoint.'); return }
          await loadBytes(new Uint8Array(await res.arrayBuffer()))
        } catch { setStatus('Could not load the document.') }
      }
    })()
    return () => { dead = true; fabsRef.current.forEach(fb => fb.dispose?.()) }
  }, [src])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    await loadBytes(new Uint8Array(await file.arrayBuffer()))
  }

  async function loadBytes(buf: Uint8Array) {
    setStatus('Rendering…')
    pdfBytesRef.current = buf.slice(0)
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    const pdf = await pdfjs.getDocument({ data: buf }).promise
    const fabric = fabricLibRef.current

    fabsRef.current.forEach(fb => fb.dispose?.())
    fabsRef.current = []; wrappersRef.current = []; undoRef.current = []
    const container = containerRef.current!; container.innerHTML = ''

    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p)
      const base = pg.getViewport({ scale: 1 })
      const scale = Math.min(SCALE, MAX_DIM / base.width, MAX_DIM / base.height)
      const vp = pg.getViewport({ scale })
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
    if (reviewTaskId) await loadSaved()
    applyToolAll()
    setStatus(`${pdf.numPages} page(s). Scroll to move through the document.`)
  }

  // ── Persist / resume the reviewer's markup layer (Phase 2) ──────────────────
  async function loadSaved() {
    try {
      const res = await fetch(`/api/reviews/${reviewTaskId}/markup`)
      if (!res.ok) return
      const layer = (await res.json())?.markup?.layer
      if (!layer) return
      skipHistoryRef.current = true
      for (const [k, json] of Object.entries(layer)) {
        const fab = fabsRef.current[Number(k)]
        if (fab && json) { await fab.loadFromJSON(json); fab.renderAll() }
      }
      skipHistoryRef.current = false
      setStatus('Loaded your saved mark-ups.')
    } catch { skipHistoryRef.current = false }
  }

  function serialize() {
    const layer: Record<number, any> = {}
    const comments: { page: number; text: string }[] = []
    fabsRef.current.forEach((fab, i) => {
      const objs = fab.getObjects()
      if (objs.length) layer[i] = fab.toJSON()
      for (const o of objs) {
        if ((o.type === 'i-text' || o.type === 'text') && String(o.text ?? '').trim())
          comments.push({ page: i + 1, text: String(o.text).trim() })
      }
    })
    return { layer, comments }
  }

  async function save() {
    if (!reviewTaskId) return
    setSaving(true); setStatus('Saving mark-ups…')
    const { layer, comments } = serialize()
    const res = await fetch(`/api/reviews/${reviewTaskId}/markup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layer, comments }),
    })
    setSaving(false)
    setStatus(res.ok ? `Saved — ${comments.length} text comment${comments.length !== 1 ? 's' : ''} captured.` : 'Could not save mark-ups.')
  }

  function wireFab(fab: any) {
    const fabric = fabricLibRef.current
    fab.on('object:added', (e: any) => { if (skipHistoryRef.current || e.target?._skipHistory) return; undoRef.current.push({ fab, obj: e.target }) })
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
    else {
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
    const img = await fabric.FabricImage.fromURL(URL.createObjectURL(f))
    const s = Math.min(1, 320 / (img.width || 320))
    img.set({ left: 40, top: 40, scaleX: s, scaleY: s })
    const fab = activeFab(); fab.add(img); fab.setActiveObject(img); fab.renderAll()
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

  async function flattenBytes(): Promise<Uint8Array | null> {
    if (!pdfBytesRef.current) return null
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.load(pdfBytesRef.current)
    const pages = doc.getPages()
    for (let i = 0; i < fabsRef.current.length; i++) {
      const fab = fabsRef.current[i]
      if (!fab.getObjects().length || !pages[i]) continue
      // Cap the export multiplier so an oversized page's flattened bitmap also stays
      // under the browser canvas limit (else Save/Download fails the same way).
      const fw = fab.getWidth?.() ?? fab.width ?? 1, fh = fab.getHeight?.() ?? fab.height ?? 1
      const mult = Math.max(1, Math.min(2, MAX_DIM / fw, MAX_DIM / fh))
      const png = await doc.embedPng(fab.toDataURL({ format: 'png', multiplier: mult }))
      const { width, height } = pages[i].getSize()
      pages[i].drawImage(png, { x: 0, y: 0, width, height })
    }
    return await doc.save()
  }

  async function flattenDownload() {
    setStatus('Flattening mark-ups into the PDF…')
    const bytes = await flattenBytes(); if (!bytes) return
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = (fileName ?? 'markup') + '-flattened.pdf'; a.click()
    URL.revokeObjectURL(url)
    setStatus('Flattened PDF downloaded — mark-ups baked in.')
  }

  // ── Phase 3: commit mark-ups back to the authoritative SharePoint file ───────
  async function saveToSharePoint() {
    if (!reviewTaskId || !src) return
    setSaving(true); setStatus('Saving to SharePoint…')
    await save()                                  // persist captured comments first
    const bytes = await flattenBytes()
    if (!bytes) { setSaving(false); return }
    const res = await fetch(`/api/reviews/${reviewTaskId}/markup/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: bytes as BlobPart,
    })
    if (res.ok) {
      setStatus('Saved to SharePoint — reloading the updated document…')
      try { const r = await fetch(src, { cache: 'no-store' }); if (r.ok) await loadBytes(new Uint8Array(await r.arrayBuffer())) } catch {}
      setStatus('Saved to SharePoint. Your mark-ups are now part of the document — the next reviewer will see them.')
    } else {
      setStatus('Could not save to SharePoint. ' + ((await res.json().catch(() => ({})))?.error ?? ''))
    }
    setSaving(false)
  }

  const Btn = ({ t, label }: { t: Tool; label: string }) => (
    <button onClick={() => setTool(t)}
      className={`px-3 py-1.5 rounded-md text-sm font-medium border ${tool === t ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
      {label}
    </button>
  )

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-white p-3' : 'space-y-3'}>
      <div className="card p-3 flex flex-wrap items-center gap-2 sticky top-2 z-10">
        {!src && <><input type="file" accept="application/pdf" onChange={onFile} disabled={!ready} className="text-sm" /><span className="mx-1 h-5 w-px bg-slate-200" /></>}
        <Btn t="select" label="Select" />
        <Btn t="pen" label="✏ Pen" />
        <Btn t="text" label="T Text" />
        <div className="flex items-center">
          <button onClick={() => setTool('shape')}
            className={`px-3 py-1.5 rounded-l-md text-sm font-medium border ${tool === 'shape' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>◆ Shape</button>
          <select value={shape} onChange={e => { setShape(e.target.value as Shape); setTool('shape') }}
            className="rounded-r-md border border-l-0 border-slate-300 text-sm py-1.5 px-1 bg-white">
            <option value="box">Box</option><option value="circle">Circle</option><option value="line">Line</option><option value="arrow">Arrow</option>
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
        {reviewTaskId && (
          <button onClick={save} disabled={saving} title="Save an editable draft (only you see it)"
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
            {saving ? 'Saving…' : '💾 Save draft'}
          </button>
        )}
        {reviewTaskId && src && (
          <button onClick={saveToSharePoint} disabled={saving} title="Write your mark-ups back to the SharePoint document for the next reviewer"
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60">
            ☁ Save to SharePoint
          </button>
        )}
        <button onClick={flattenDownload} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50">Download copy</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={() => setFullscreen(v => !v)} title={fullscreen ? 'Exit full screen (Esc)' : 'Review using the whole screen'}
          className="px-3 py-1.5 rounded-md text-sm font-medium border border-slate-300 hover:bg-slate-50">
          {fullscreen ? '✕ Exit full screen' : '⛶ Full screen'}
        </button>
      </div>
      <p className="text-xs text-slate-500">{status}</p>
      <div ref={containerRef} className={`rounded-lg bg-slate-100 p-6 overflow-auto ${fullscreen ? 'flex-1 min-h-0' : 'max-h-[80vh]'}`} />
    </div>
  )
}
