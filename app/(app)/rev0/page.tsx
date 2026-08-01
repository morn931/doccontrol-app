'use client'
// Rev 0 Intake (ruled 2026-07-31): vendors drop issued Rev 0+ documents in
// "Live Documents/Rev 0 and up Documents" on their vendor site and email Doc
// Control. Here she browses that folder live, stamps each file with the PPE
// stamp (document number / revision / date auto-filled, outcome picked, her
// signature affixed), drags the stamp to the best spot, and one click writes
// the stamped PDF back OVER the vendor's copy and files a copy in our
// per-package bucket — with a register line recording it all.
import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { ArrowLeft, FileText, Folder, Stamp, CheckCircle, UploadCloud } from 'lucide-react'

const CHUNK = 5 * 1024 * 1024 - (5 * 1024 * 1024) % (320 * 1024)
const SCALE = 1.4, MAX_DIM = 4000

type Pkg = { packageId: string; code: string; name: string; siteUrl: string; bucketLibrary: string | null; stampedFiles: string[] }
type Item = { name: string; isFolder: boolean; size: number; webUrl: string }

const OUTCOMES = ['A1 - APPROVED', 'B1 - APPROVED WITH COMMENTS', 'D1 - FOR INFORMATION', 'C1 - REVISE AND RESUBMIT']

function parseNumber(fileName: string): { num: string; rev: string } {
  const base = fileName.replace(/\.[^.]+$/, '')
  const m = base.match(/^(.*?)_([A-Za-z0-9]{1,4})$/)
  return m ? { num: m[1], rev: m[2] } : { num: base, rev: '' }
}

async function composeStamp(fields: { num: string; rev: string; outcome: string; date: string }, sigUrl: string | null): Promise<string> {
  const W = 560, H = 440
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
  const logo = new Image(); logo.src = '/coreflow/logo/ppe-logo.png'
  await new Promise(res => { logo.onload = res; logo.onerror = res })
  if (logo.width) {
    const lh = 120, lw = lh * (logo.width / logo.height)
    g.drawImage(logo, (W - lw) / 2, 12, lw, lh)
  }
  g.fillStyle = '#111'; g.textBaseline = 'alphabetic'
  g.font = 'bold 26px Arial'
  const title = 'Power Plant Electrical Technologies'
  const tw = g.measureText(title).width
  g.fillText(title, (W - tw) / 2, 172)
  g.strokeStyle = '#111'; g.lineWidth = 2
  g.beginPath(); g.moveTo((W - tw) / 2, 178); g.lineTo((W + tw) / 2, 178); g.stroke()

  const row = (y: number, label: string, value: string, valueColor = '#111', valueBold = false) => {
    g.fillStyle = '#111'; g.font = 'bold 24px Arial'
    g.fillText(label, 24, y)
    const lw2 = g.measureText(label).width
    g.fillStyle = valueColor; g.font = `${valueBold ? 'bold ' : ''}20px Arial`
    g.fillText(value, 24 + lw2 + 14, y)
  }
  row(226, 'Document Number:', fields.num)
  row(272, 'Revision:', fields.rev)
  row(318, 'Review Outcome:', fields.outcome, '#d90000', true)
  row(364, 'Date:', fields.date)

  if (sigUrl) {
    const sig = new Image(); sig.src = sigUrl
    await new Promise(res => { sig.onload = res; sig.onerror = res })
    if (sig.width) {
      const sh = 74, sw = sh * (sig.width / sig.height)
      g.drawImage(sig, W - sw - 28, H - sh - 14, sw, sh)
    }
  }
  return c.toDataURL('image/png')
}

export default function Rev0IntakePage() {
  const [pkgs, setPkgs] = useState<Pkg[]>([])
  const [pkg, setPkg] = useState<Pkg | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [subPath, setSubPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  // stamping state
  const [target, setTarget] = useState<Item | null>(null)
  const [num, setNum] = useState(''); const [rev, setRev] = useState('')
  const [outcome, setOutcome] = useState(OUTCOMES[0])
  const [dateStr, setDateStr] = useState(format(new Date(), 'dd-MM-yyyy'))
  const [placing, setPlacing] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<any>(null)
  const fabsRef = useRef<any[]>([])
  const stampObjRef = useRef<{ pageIdx: number } | null>(null)
  const pdfBytesRef = useRef<Uint8Array | null>(null)
  const stampUrlRef = useRef<string>('')

  useEffect(() => { (async () => {
    const res = await fetch('/api/rev0/packages')
    if (res.ok) setPkgs((await res.json()).packages ?? [])
  })() }, [])

  async function openPkg(p: Pkg, sub = '') {
    setPkg(p); setSubPath(sub); setItems([]); setError(''); setLoading(true); setTarget(null); setPlacing(false)
    const res = await fetch(`/api/rev0/browse?packageId=${p.packageId}${sub ? `&path=${encodeURIComponent(sub)}` : ''}`)
    const d = await res.json()
    setLoading(false)
    if (!res.ok) { setError(d.error ?? 'Could not list the vendor folder'); return }
    setItems(d.items ?? [])
  }

  async function startStamp(f: Item) {
    setTarget(f); setDoneMsg(''); setError('')
    const p = parseNumber(f.name)
    setNum(p.num); setRev(p.rev)
    setDateStr(format(new Date(), 'dd-MM-yyyy'))
  }

  async function openPlacement() {
    if (!target) return
    setBusy('Loading document…'); setError('')
    try {
      const [fabricMod, res, sigRes] = await Promise.all([
        import('fabric'),
        fetch(`/api/rev0/file?url=${encodeURIComponent(target.webUrl)}`),
        // own signature if saved, else the company default signatory's — the
        // stamp never goes out unsigned
        fetch('/api/rev0/signature').then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      if (!res.ok) throw new Error('Could not load the document from the vendor site')
      fabricRef.current = fabricMod
      const buf = new Uint8Array(await res.arrayBuffer())
      pdfBytesRef.current = buf.slice(0)
      stampUrlRef.current = await composeStamp({ num, rev, outcome, date: dateStr }, sigRes?.signature ?? null)

      setPlacing(true); setBusy('Rendering…')
      await new Promise(r => setTimeout(r, 30))
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const pdf = await pdfjs.getDocument({ data: buf }).promise
      const fabric = fabricRef.current
      fabsRef.current.forEach(fb => fb.dispose?.()); fabsRef.current = []
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
        const fab = new fabric.Canvas(fc, { width: vp.width, height: vp.height })
        if (fab.wrapperEl) { fab.wrapperEl.style.position = 'absolute'; fab.wrapperEl.style.top = '0'; fab.wrapperEl.style.left = '0' }
        fabsRef.current.push(fab)
        const pageIdx = p - 1
        // dropping the stamp onto a page moves it there
        fab.on('mouse:down', () => {
          if (!stampObjRef.current || stampObjRef.current.pageIdx === pageIdx) return
          moveStampTo(pageIdx)
        })
      }
      placeStampOn(0)
      setBusy('')
    } catch (e: any) { setBusy(''); setPlacing(false); setError(e?.message ?? 'Failed to open') }
  }

  function placeStampOn(pageIdx: number) {
    const fabric = fabricRef.current
    fabric.FabricImage.fromURL(stampUrlRef.current).then((img: any) => {
      const fab = fabsRef.current[pageIdx]; if (!fab) return
      img.scaleToWidth(Math.min(300, fab.getWidth() * 0.4))
      img.set({ left: fab.getWidth() - img.getScaledWidth() - 30, top: 30, cornerColor: '#0d9488', transparentCorners: false })
      fab.add(img); fab.setActiveObject(img); fab.renderAll()
      stampObjRef.current = { pageIdx }
    })
  }
  function moveStampTo(pageIdx: number) {
    const cur = stampObjRef.current; if (!cur) return
    const oldFab = fabsRef.current[cur.pageIdx]
    oldFab?.getObjects().forEach((o: any) => oldFab.remove(o))
    oldFab?.renderAll()
    placeStampOn(pageIdx)
  }

  async function applyAndFile() {
    if (!pkg || !target || !pdfBytesRef.current) return
    setBusy('Flattening the stamp into the PDF…'); setError('')
    try {
      const { PDFDocument } = await import('pdf-lib')
      const doc = await PDFDocument.load(pdfBytesRef.current, { ignoreEncryption: true })
      const pages = doc.getPages()
      for (let i = 0; i < fabsRef.current.length; i++) {
        const fab = fabsRef.current[i]
        if (!fab.getObjects().length || !pages[i]) continue
        const fw = fab.getWidth?.() ?? 1, fh = fab.getHeight?.() ?? 1
        const mult = Math.max(1, Math.min(2, MAX_DIM / fw, MAX_DIM / fh))
        const png = await doc.embedPng(fab.toDataURL({ format: 'png', multiplier: mult }))
        const { width, height } = pages[i].getSize()
        pages[i].drawImage(png, { x: 0, y: 0, width, height })
      }
      const bytes = await doc.save()

      setBusy('Requesting upload sessions…')
      const start = await fetch('/api/rev0/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.packageId, subPath, fileName: target.name, bucketLibrary: pkg.bucketLibrary }),
      })
      const sd = await start.json()
      if (!start.ok) throw new Error(sd.error ?? 'Upload sessions failed')

      const uploadTo = async (uploadUrl: string, label: string) => {
        let item: any = null
        for (let pos = 0; pos < bytes.length; pos += CHUNK) {
          const part = bytes.slice(pos, pos + CHUNK)
          setBusy(`${label} — ${Math.round(((pos + part.length) / bytes.length) * 100)}%`)
          const r = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${pos}-${pos + part.length - 1}/${bytes.length}` },
            body: part as unknown as BodyInit,
          })
          if (!r.ok && r.status !== 202) throw new Error(`${label} failed (${r.status})`)
          if (r.status === 200 || r.status === 201) item = await r.json()
        }
        return item
      }
      const vendorItem = await uploadTo(sd.vendorUploadUrl, 'Replacing the vendor copy')
      const bucketItem = await uploadTo(sd.bucketUploadUrl, 'Filing our bucket copy')

      setBusy('Recording the register line…')
      const reg = await fetch('/api/rev0/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: pkg.packageId, documentNumber: num, revision: rev, outcome,
          stampDate: format(new Date(), 'yyyy-MM-dd'), fileName: target.name,
          vendorFileUrl: vendorItem?.webUrl ?? target.webUrl, bucketFileUrl: bucketItem?.webUrl ?? null,
        }),
      })
      if (!reg.ok) throw new Error((await reg.json()).error ?? 'Register failed')
      setBusy(''); setPlacing(false); setTarget(null)
      setDoneMsg(`${target.name} stamped — vendor copy replaced and filed in ${pkg.bucketLibrary}/Rev 0 and up Documents.`)
      await openPkg(pkg, subPath)
    } catch (e: any) { setBusy(''); setError(e?.message ?? 'Something went wrong') }
  }

  // ── render ──
  if (placing && target) return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => { setPlacing(false) }} className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <p className="text-sm text-slate-600">
          Drag the stamp to the best spot (click another page to move it there), then press
          <b> Apply &amp; file</b> — the stamped PDF replaces the vendor's copy and is filed in our bucket.
        </p>
        <button onClick={applyAndFile} disabled={!!busy} className="btn-primary text-sm ml-auto disabled:opacity-50">
          <Stamp className="h-4 w-4" /> {busy || 'Apply & file'}
        </button>
      </div>
      {error && <div className="card p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}
      <div ref={containerRef} className="overflow-auto rounded-lg bg-slate-100 p-4" style={{ maxHeight: '78vh' }} />
    </div>
  )

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Rev 0 Intake</h1>
        <p className="text-slate-500 text-sm mt-1">
          Issued vendor documents (Rev 0 and up) from the vendor's "Rev 0 and up Documents" folder:
          stamp them, replace the vendor's copy with the stamped version, and file a copy in our bucket.
        </p>
      </div>

      {doneMsg && <div className="card p-3 bg-green-50 border-green-200 text-emerald-800 text-sm flex items-center gap-2"><CheckCircle className="h-4 w-4" /> {doneMsg}</div>}
      {error && !placing && <div className="card p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}
      {busy && <div className="card p-3 text-sm text-navy-700 flex items-center gap-2"><UploadCloud className="h-4 w-4 animate-pulse" /> {busy}</div>}

      <div className="card p-5">
        <label className="label">Package / vendor</label>
        <select className="input" value={pkg?.packageId ?? ''}
          onChange={e => { const p = pkgs.find(x => x.packageId === e.target.value); if (p) openPkg(p) }}>
          <option value="">Select a package…</option>
          {pkgs.map(p => <option key={p.packageId} value={p.packageId}>{p.code} — {p.name}</option>)}
        </select>
        {pkg && !pkg.bucketLibrary && (
          <p className="text-xs text-amber-700 mt-2">⚠ No bucket derivable for this package yet (no batch history) — stamping is blocked until one exists.</p>
        )}
      </div>

      {pkg && (
        <div className="card">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 text-sm text-slate-600">
            <Folder className="h-4 w-4 text-slate-400" />
            Rev 0 and up Documents{subPath ? ` / ${subPath}` : ''}
            {subPath && <button onClick={() => openPkg(pkg)} className="ml-2 text-xs text-teal-700 hover:underline">↑ up</button>}
          </div>
          <div className="divide-y divide-slate-50">
            {loading ? (
              <div className="px-5 py-8 text-center text-slate-400">Loading vendor folder…</div>
            ) : items.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-400">Folder is empty.</div>
            ) : items.map(f => {
              const stamped = pkg.stampedFiles.includes(f.name)
              return (
                <div key={f.name} className="px-5 py-3 flex items-center gap-3">
                  {f.isFolder ? <Folder className="h-4 w-4 text-amber-500 shrink-0" /> : <FileText className="h-4 w-4 text-slate-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    {f.isFolder ? (
                      <button onClick={() => openPkg(pkg, subPath ? `${subPath}/${f.name}` : f.name)}
                        className="text-sm font-medium text-slate-800 hover:text-teal-700">{f.name}</button>
                    ) : (
                      <p className="font-mono text-xs text-slate-700 truncate">{f.name}</p>
                    )}
                  </div>
                  {stamped && <span className="px-2 py-0.5 rounded-full bg-green-100 text-emerald-700 text-xs font-semibold">✓ stamped</span>}
                  {!f.isFolder && /\.pdf$/i.test(f.name) && (
                    <button onClick={() => startStamp(f)} className="btn-secondary text-xs py-1 px-2.5" disabled={!pkg.bucketLibrary}>
                      <Stamp className="h-3.5 w-3.5" /> Stamp
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* stamp fields */}
      {target && (
        <div className="card p-5 space-y-3 border-teal-200">
          <h2 className="font-semibold text-slate-900">Stamp — <span className="font-mono text-sm">{target.name}</span></h2>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Document Number</label>
              <input value={num} onChange={e => setNum(e.target.value)} className="input font-mono" /></div>
            <div><label className="label">Revision</label>
              <input value={rev} onChange={e => setRev(e.target.value)} className="input font-mono" /></div>
            <div><label className="label">Review Outcome</label>
              <select value={outcome} onChange={e => setOutcome(e.target.value)} className="input">
                {OUTCOMES.map(o => <option key={o}>{o}</option>)}
              </select></div>
            <div><label className="label">Date</label>
              <input value={dateStr} onChange={e => setDateStr(e.target.value)} className="input" /></div>
          </div>
          <p className="text-xs text-slate-400">
            The stamp carries your saved Coreflow signature if you have one (coreflow.build → ✍ Signature);
            otherwise the company default signatory's signature is applied automatically.
          </p>
          <div className="flex gap-2">
            <button onClick={openPlacement} disabled={!!busy || !num.trim()} className="btn-primary text-sm disabled:opacity-50">
              <Stamp className="h-4 w-4" /> {busy || 'Open & place stamp'}
            </button>
            <button onClick={() => setTarget(null)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
