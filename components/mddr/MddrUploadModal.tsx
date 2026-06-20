'use client'
import { useState, useRef } from 'react'
import { X, Upload, FileSpreadsheet, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

type UploadMode = 'merge' | 'override'
type RegisterType = 'SDDR' | 'CDDL' | 'MDDR'

interface UploadResult {
  inserted: number
  updated: number
  skipped: number
  errors: string[]
}

export function MddrUploadModal({ onClose, onSuccess }: Props) {
  const [file,         setFile]         = useState<File | null>(null)
  const [regType,      setRegType]      = useState<RegisterType>('SDDR')
  const [packageCode,  setPackageCode]  = useState('')
  const [vendorName,   setVendorName]   = useState('')
  const [mode,         setMode]         = useState<UploadMode>('merge')
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState<UploadResult | null>(null)
  const [error,        setError]        = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(f: File | null) {
    setFile(f)
    setResult(null)
    setError(null)
    // Try to auto-detect type and package from filename
    if (f) {
      const name = f.name.toUpperCase()
      if (name.includes('CDDL'))      setRegType('CDDL')
      else if (name.includes('MDDR') || name.includes('GMDR')) setRegType('MDDR')
      else                            setRegType('SDDR')

      const pkgMatch = name.match(/\b(K\d{3}|E\d{3}[A-Z]?)\b/)
      if (pkgMatch) setPackageCode(pkgMatch[1])
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return

    setLoading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file',         file)
    formData.append('register_type', regType)
    formData.append('package_code', packageCode)
    formData.append('vendor_name',  vendorName)
    formData.append('upload_mode',  mode)

    try {
      const res  = await fetch('/api/mddr/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Upload failed')
      } else {
        setResult(data)
        if ((data.errors?.length ?? 0) === 0) {
          setTimeout(onSuccess, 1500)
        }
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const isDone = result && result.errors.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-navy-600" />
            Upload Register
          </h2>
          <button onClick={onClose} disabled={loading} className="text-slate-400 hover:text-slate-600 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Drop zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault() }}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0] ?? null) }}
            className={cn(
              'border-2 border-dashed rounded-lg px-4 py-8 text-center cursor-pointer transition-colors',
              file ? 'border-navy-400 bg-navy-50' : 'border-slate-300 hover:border-navy-400 hover:bg-slate-50'
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => handleFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="h-8 w-8 text-navy-500" />
                <div className="text-left">
                  <p className="font-medium text-navy-700 text-sm">{file.name}</p>
                  <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button type="button" onClick={e => { e.stopPropagation(); setFile(null) }}
                  className="ml-2 text-slate-400 hover:text-red-500">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-600">Drop an Excel file here or click to browse</p>
                <p className="text-xs text-slate-400 mt-1">.xlsx or .xls · SDDR, CDDL, or MDDR</p>
              </>
            )}
          </div>

          {/* Register type */}
          <div>
            <label className="label">Register Type</label>
            <div className="flex gap-3">
              {(['SDDR','CDDL','MDDR'] as RegisterType[]).map(t => (
                <button
                  key={t} type="button"
                  onClick={() => setRegType(t)}
                  className={cn(
                    'flex-1 py-2 rounded-md text-sm font-semibold border transition-colors',
                    regType === t
                      ? 'bg-navy-700 text-white border-navy-700'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-navy-400'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Package & Vendor */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Package Code <span className="text-slate-400 font-normal">(e.g. K137)</span></label>
              <input type="text" value={packageCode} onChange={e => setPackageCode(e.target.value.toUpperCase())}
                placeholder="K137" className="input" />
            </div>
            <div>
              <label className="label">Vendor / Originator</label>
              <input type="text" value={vendorName} onChange={e => setVendorName(e.target.value)}
                placeholder="ABB, PPE, etc." className="input" />
            </div>
          </div>

          {/* Upload mode */}
          <div>
            <label className="label">Upload Mode</label>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className={cn(
                'flex gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
                mode === 'merge' ? 'border-navy-500 bg-navy-50' : 'border-slate-200 hover:border-slate-300'
              )}>
                <input type="radio" name="mode" value="merge" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-800">Merge / Update</p>
                  <p className="text-xs text-slate-500 mt-0.5">Add new rows, update existing ones by document number. Existing entries not in the file are kept.</p>
                </div>
              </label>
              <label className={cn(
                'flex gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
                mode === 'override' ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
              )}>
                <input type="radio" name="mode" value="override" checked={mode === 'override'} onChange={() => setMode('override')} className="mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-800">Replace / Override</p>
                  <p className="text-xs text-slate-500 mt-0.5">Delete all existing entries from this register source, then reload from this file.</p>
                </div>
              </label>
            </div>
          </div>

          {/* Result feedback */}
          {result && (
            <div className={cn('p-3 rounded-lg text-sm', isDone ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800')}>
              {isDone
                ? <p className="flex items-center gap-2"><CheckCircle className="h-4 w-4" /> Import complete — {result.inserted} inserted, {result.updated} updated, {result.skipped} skipped</p>
                : (
                  <>
                    <p className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> Completed with {result.errors.length} error(s)</p>
                    <p className="mt-1">{result.inserted} inserted · {result.updated} updated · {result.skipped} skipped</p>
                    <ul className="mt-2 space-y-1 text-xs max-h-32 overflow-y-auto">
                      {result.errors.slice(0, 20).map((e, i) => <li key={i}>• {e}</li>)}
                    </ul>
                  </>
                )
              }
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={loading} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={!file || loading || !!isDone} className="btn-primary flex-1">
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</>
                : isDone
                  ? <><CheckCircle className="h-4 w-4" /> Done</>
                  : <><Upload className="h-4 w-4" /> Import Register</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
