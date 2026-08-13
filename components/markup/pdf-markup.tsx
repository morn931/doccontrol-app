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

export default function PdfMarkup({ src, fileName, reviewTaskId, initialColor, endpointBase, allowDraftSave = true }: { src?: string; fileName?: string; reviewTaskId?: string; initialColor?: string; endpointBase?: string; allowDraftSave?: boolean }) {
  // endpointBase generalises persistence: review tasks use /api/reviews/<id>,
  // draft site redlines pass /api/redlines/docs/<id> — same GET/POST /markup + /markup/commit contract.
  const apiBase = endpointBase ?? (reviewTaskId ? `/api/reviews/${reviewTaskId}` : null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  const fabricLibRef = useRef<any>(null)
  const pdfBytesRef = useRef<Uint8Array | null>(null)
  const fabsRef = useRef<any[]>([])
  const wrappersRef = useRef<HTMLElement[]>([])
  const outersRef = useRef<HTMLElement[]>([])         // per-page layout boxes (sized to zoom)
  const pageDimsRef = useRef<{ w: number; h: number }[]>([])  // logical page size (zoom = 1)
  const undoRef = useRef<{ fab: any; obj: any }[]>([])
  const skipHistoryRef = useRef(false)
  const pendingSigRef = useRef<{ sigUrl: string; panelUrl: string } | null>(null)  // armed by "Apply signature" → placed on next click

  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<Shape>('box')
  const [color, setColor] = useState(initialColor ?? '#e11d48')
  const [status, setStatus] = useState(src ? 'Loading document…' : 'Load a PDF to begin.')
  const [fullscreen, setFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)

  // Esc leaves full-screen review mode.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // Zoom: scale each page's layout box + CSS-transform its content (PDF canvas + fabric
  // markup together, so annotations stay aligned). Clamped 40%–400%.
  function applyZoom(next: number) {
    const z = Math.min(4, Math.max(0.4, Math.round(next * 100) / 100))
    zoomRef.current = z; setZoom(z)
    outersRef.current.forEach((outer, i) => {
      const d = pageDimsRef.current[i]; if (!d) return
      outer.style.width = `${d.w * z}px`; outer.style.height = `${d.h * z}px`
      const inner = outer.firstElementChild as HTMLElement | null
      if (inner) inner.style.transform = `scale(${z})`
    })
  }

  // Ctrl/⌘ + wheel (and trackpad pinch, which fires ctrl+wheel) zooms at the cursor.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      applyZoom(zoomRef.current + (e.deltaY < 0 ? 0.15 : -0.15))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

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
    fabsRef.current = []; wrappersRef.current = []; outersRef.current = []; pageDimsRef.current = []; undoRef.current = []
    const container = containerRef.current!; container.innerHTML = ''

    // Render the PDF bitmap at a higher resolution than it is displayed, so zooming in
    // stays crisp (the browser down-samples a hi-res canvas cleanly). Fabric + display
    // stay at the logical size; CSS zoom scales page + markup together (see applyZoom).
    const RENDER_MULT = 2
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p)
      const base = pg.getViewport({ scale: 1 })
      const scale = Math.min(SCALE, MAX_DIM / base.width, MAX_DIM / base.height)
      const vp = pg.getViewport({ scale })                                   // logical (display) size
      const rscale = Math.min(scale * RENDER_MULT, MAX_DIM / base.width, MAX_DIM / base.height)
      const rvp = pg.getViewport({ scale: rscale })                          // hi-res render size
      const outer = document.createElement('div')                           // layout box — sized to zoom
      outer.className = 'mx-auto mb-6'
      outer.style.width = `${vp.width}px`; outer.style.height = `${vp.height}px`
      const wrap = document.createElement('div')
      wrap.className = 'relative border-2 border-slate-500 shadow-lg bg-white'
      wrap.style.width = `${vp.width}px`; wrap.style.height = `${vp.height}px`; wrap.style.transformOrigin = 'top left'
      const pc = document.createElement('canvas')
      pc.width = rvp.width; pc.height = rvp.height
      pc.style.width = `${vp.width}px`; pc.style.height = `${vp.height}px`; pc.style.display = 'block'
      const fc = document.createElement('canvas')
      wrap.appendChild(pc); wrap.appendChild(fc); outer.appendChild(wrap); container.appendChild(outer)
      await pg.render({ canvasContext: pc.getContext('2d')!, viewport: rvp }).promise
      const fab = new fabric.Canvas(fc, { width: vp.width, height: vp.height, backgroundColor: undefined })
      if (fab.wrapperEl) { fab.wrapperEl.style.position = 'absolute'; fab.wrapperEl.style.top = '0'; fab.wrapperEl.style.left = '0' }
      wireFab(fab)
      fabsRef.current.push(fab); wrappersRef.current.push(wrap); outersRef.current.push(outer)
      pageDimsRef.current.push({ w: vp.width, h: vp.height })
    }
    if (apiBase) await loadSaved()
    applyToolAll()
    applyZoom(zoomRef.current)   // re-apply the current zoom to the freshly rendered pages
    setStatus(`${pdf.numPages} page(s). Scroll to move through the document.`)
  }

  // ── Persist / resume the reviewer's markup layer (Phase 2) ──────────────────
  async function loadSaved() {
    try {
      const res = await fetch(`${apiBase}/markup`)
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
    if (!apiBase) return
    setSaving(true); setStatus('Saving mark-ups…')
    const { layer, comments } = serialize()
    const res = await fetch(`${apiBase}/markup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layer, comments }),
    })
    setSaving(false)
    setStatus(res.ok ? `Saved — ${comments.length} text comment${comments.length !== 1 ? 's' : ''} captured.` : 'Could not save mark-ups.')
  }

  function wireFab(fab: any) {
    const fabric = fabricLibRef.current
    fab.on('object:added', (e: any) => { if (skipHistoryRef.current || e.target?._skipHistory) return; undoRef.current.push({ fab, obj: e.target }) })
    fab.on('mouse:down', (opt: any) => {
      if (pendingSigRef.current) {   // "Apply signature" armed → drop it where the user clicked
        const pp = fab.getScenePoint ? fab.getScenePoint(opt.e) : fab.getPointer(opt.e)
        placeSignatureAt(fab, pp)
        return
      }
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

  // ── Sign-off = TWO independent overlays: the signature (drop into the approval block and
  // size to fit) + a separate details panel (place where there's room; stays legible). ──
  async function composeTextPanel(name: string): Promise<string> {
    const SS = 4, W = 300, H = 128       // text-only; transparent, no border, supersampled
    const cv = document.createElement('canvas'); cv.width = W * SS; cv.height = H * SS
    const g = cv.getContext('2d')!; g.scale(SS, SS)
    const now = new Date()
    const off = -now.getTimezoneOffset(), sgn = off >= 0 ? '+' : '-'
    const p2 = (n: number) => String(n).padStart(2, '0')
    const tz = `${sgn}${p2(Math.floor(Math.abs(off) / 60))}'${p2(Math.abs(off) % 60)}'`
    const dt = `${now.getFullYear()}.${p2(now.getMonth() + 1)}.${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())} ${tz}`
    const vid = ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(now.getTime())).replace(/-/g, '').slice(0, 10).toUpperCase()
    g.textBaseline = 'alphabetic'
    g.fillStyle = '#0b3b8c'; g.font = 'bold 20px Helvetica, Arial'; g.fillText('Reviewed & Approved', 1, 22)
    g.fillStyle = '#1e293b'; g.font = '15.5px Helvetica, Arial'
    g.fillText(`Digitally signed by ${name}`, 1, 50)
    g.fillText(`Date: ${dt}`, 1, 72)
    g.fillStyle = '#475569'; g.font = '13.5px Helvetica, Arial'; g.fillText('PPE Technologies', 1, 98)
    g.fillStyle = '#94a3b8'; g.font = '12px Helvetica, Arial'; g.fillText(`Verify ID: ${vid}`, 1, 118)
    return cv.toDataURL('image/png')
  }
  async function applySignature() {
    setStatus('Fetching your signature…')
    try {
      const res = await fetch('/api/signature/mine')
      const data = await res.json()
      if (!data?.signature) {
        setStatus('No signature on file — set one up at coreflow.build → ✍ Signature, then try again.')
        return
      }
      const panelUrl = await composeTextPanel(data.name || 'Reviewer')
      pendingSigRef.current = { sigUrl: data.signature, panelUrl }
      setTool('select')  // so the placement click selects/places rather than draws
      fabsRef.current.forEach((f: any) => { f.isDrawingMode = false; f.defaultCursor = 'crosshair' })
      setStatus('Now click where you want the signature — it drops there. Then size/move each piece and Save to SharePoint.')
    } catch (e: any) {
      setStatus('Could not fetch the signature: ' + (e?.message || 'error'))
    }
  }
  async function placeSignatureAt(fab: any, p: { x: number; y: number }) {
    const pend = pendingSigRef.current
    if (!pend) return
    pendingSigRef.current = null
    fabsRef.current.forEach((f: any) => { f.defaultCursor = 'default' })
    const fabric = fabricLibRef.current
    // 1) the signature — dropped at the click; size it to fill the block
    const sig = await fabric.FabricImage.fromURL(pend.sigUrl)
    const sigW = 240, ss = sigW / (sig.width || sigW)
    sig.set({ left: p.x, top: p.y, scaleX: ss, scaleY: ss, opacity: 0.92 })
    fab.add(sig)
    // 2) the audit details — a separate object just to the right; move where it reads
    const txt = await fabric.FabricImage.fromURL(pend.panelUrl)
    const txtW = 300, ts = txtW / (txt.width || txtW)
    txt.set({ left: p.x + sigW + 20, top: p.y, scaleX: ts, scaleY: ts })
    fab.add(txt); fab.setActiveObject(sig); fab.renderAll()
    setStatus('Placed — size the signature into the block, move the details panel, then Save to SharePoint.')
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
    // ignoreEncryption: vendors often "lock" a PDF with a permissions/owner-password
    // restriction (Adobe "restrict editing") after e-signing. Without this flag pdf-lib
    // throws on load and Save fails; with it we can still stamp our appearance on top.
    // (A user-password/can't-even-open PDF would never have rendered in the viewer.)
    const doc = await PDFDocument.load(pdfBytesRef.current, { ignoreEncryption: true })
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
    if (!apiBase || !src) return
    setSaving(true); setStatus('Saving to SharePoint…')
    await save()                                  // persist captured comments first
    const bytes = await flattenBytes()
    if (!bytes) { setSaving(false); return }
    const res = await fetch(`${apiBase}/markup/commit`, {
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

  function fitWidth() {
    const el = containerRef.current; const d = pageDimsRef.current[0]
    if (!el || !d) return
    applyZoom((el.clientWidth - 48) / d.w)   // container has p-6 (24px each side)
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
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={applySignature} title="Add your Coreflow sign-off signature stamp"
          className="px-3 py-1.5 rounded-md text-sm font-semibold border border-teal-600 text-teal-700 hover:bg-teal-50">✍ Apply signature</button>
        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-8 w-8 rounded border border-slate-300" />
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={undo} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50">↶ Undo</button>
        <button onClick={deleteSelected} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50">Delete</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {apiBase && (
          <button onClick={save} disabled={saving || !allowDraftSave}
            title={allowDraftSave ? 'Save an editable draft (only you see it)'
                                  : 'Not needed here — use ☁ Save to SharePoint to keep your mark-ups'}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Saving…' : '💾 Save draft'}
          </button>
        )}
        {apiBase && src && (
          <button onClick={saveToSharePoint} disabled={saving} title="Write your mark-ups back to the SharePoint document for the next reviewer"
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60">
            ☁ Save to SharePoint
          </button>
        )}
        <button onClick={flattenDownload} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50">Download copy</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <div className="flex items-center rounded-md border border-slate-300 overflow-hidden">
          <button onClick={() => applyZoom(zoomRef.current - 0.2)} title="Zoom out" className="px-2.5 py-1.5 text-sm hover:bg-slate-50">−</button>
          <button onClick={() => applyZoom(1)} title="Reset to 100%" className="px-2 py-1.5 text-sm tabular-nums min-w-[3.25rem] border-x border-slate-300 hover:bg-slate-50">{Math.round(zoom * 100)}%</button>
          <button onClick={() => applyZoom(zoomRef.current + 0.2)} title="Zoom in" className="px-2.5 py-1.5 text-sm hover:bg-slate-50">+</button>
          <button onClick={fitWidth} title="Fit to width" className="px-2.5 py-1.5 text-sm border-l border-slate-300 hover:bg-slate-50">Fit</button>
        </div>
        <span className="text-[11px] text-slate-400 hidden sm:inline">Ctrl/⌘ + scroll to zoom</span>
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
