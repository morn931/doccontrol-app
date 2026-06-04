'use client'
import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Upload, FileText, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react'

type ImportMode = 'dry_run' | 'full' | 'incremental'
type ImportSource = 'approver_picks' | 'document_approval_list'
type RunStatus = 'idle' | 'parsing' | 'uploading' | 'running' | 'done' | 'error'

interface RunResult {
  runId?: string
  status?: string
  records_scanned?: number
  records_created?: number
  records_updated?: number
  records_failed?: number
  error_log?: string
  error?: string
}

export default function ImportPage() {
  const [source, setSource]     = useState<ImportSource>('approver_picks')
  const [mode, setMode]         = useState<ImportMode>('dry_run')
  const [file, setFile]         = useState<File | null>(null)
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [result, setResult]     = useState<RunResult | null>(null)
  const [rowCount, setRowCount] = useState<number>(0)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult(null)
    setRunStatus('parsing')

    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setRowCount(results.data.length)
        setRunStatus('idle')
      },
      error: (err) => {
        setResult({ error: err.message })
        setRunStatus('error')
      },
    })
  }

  async function handleRun() {
    if (!file) return
    setRunStatus('parsing')
    setResult(null)

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        setRunStatus('uploading')
        try {
          const res = await fetch('/api/admin/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, mode, csvData: parsed.data }),
          })
          const json = await res.json()
          if (!res.ok) { setResult({ error: json.error }); setRunStatus('error'); return }
          // Server now returns result synchronously — no polling needed
          setResult(json)
          setRunStatus('done')
        } catch (e: any) {
          setResult({ error: e.message })
          setRunStatus('error')
        }
      },
    })
  }

  const SOURCE_LABELS: Record<ImportSource, string> = {
    approver_picks:           'Approver Picks (Agent) — Batch records',
    document_approval_list:   'Document Approval List (Agent) — Review task records',
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import & Sync</h1>
        <p className="text-gray-500 text-sm mt-1">
          Import existing SharePoint data into the new database.
          Always run a <strong>dry run</strong> first to preview results before committing.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        {/* Source */}
        <div>
          <label className="label">Import Source</label>
          <select value={source} onChange={e => setSource(e.target.value as ImportSource)} className="input">
            {(Object.entries(SOURCE_LABELS) as [ImportSource, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            {source === 'approver_picks'
              ? 'Export from SharePoint: Document Control → Approver Picks (Agent) → Export to CSV'
              : 'Export from SharePoint: Document Control → Document Approval List (Agent) → Export to CSV'}
          </p>
        </div>

        {/* Mode */}
        <div>
          <label className="label">Import Mode</label>
          <div className="grid grid-cols-3 gap-3">
            {(['dry_run','full','incremental'] as ImportMode[]).map(m => (
              <label key={m} className={`flex flex-col p-3 border rounded-lg cursor-pointer transition-colors ${
                mode === m ? 'border-navy-500 bg-navy-50' : 'border-gray-200 hover:border-gray-300'
              }`}>
                <input type="radio" name="mode" value={m} checked={mode === m}
                  onChange={() => setMode(m)} className="sr-only" />
                <span className="font-medium text-sm text-gray-900 capitalize">{m.replace('_', ' ')}</span>
                <span className="text-xs text-gray-500 mt-0.5">
                  {m === 'dry_run'     && 'Validate only — no changes made'}
                  {m === 'full'        && 'Insert/update all records'}
                  {m === 'incremental' && 'Only process new records'}
                </span>
              </label>
            ))}
          </div>
          {mode !== 'dry_run' && (
            <div className="mt-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span><strong>Live import:</strong> This will write to the database. Run a dry run first to confirm the data looks correct.</span>
            </div>
          )}
        </div>

        {/* File upload */}
        <div>
          <label className="label">CSV File</label>
          <div
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              file ? 'border-navy-300 bg-navy-50' : 'border-gray-200 hover:border-gray-300'
            }`}>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
            {file ? (
              <div>
                <FileText className="h-8 w-8 text-navy-500 mx-auto mb-2" />
                <p className="font-medium text-gray-900">{file.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{rowCount.toLocaleString()} rows detected</p>
              </div>
            ) : (
              <div>
                <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="font-medium text-gray-700">Click to select CSV file</p>
                <p className="text-sm text-gray-400 mt-0.5">Export from SharePoint as CSV</p>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={!file || runStatus === 'parsing' || runStatus === 'uploading' || runStatus === 'running'}
          className="btn-primary w-full justify-center">
          {runStatus === 'parsing'   && <><Loader2 className="h-4 w-4 animate-spin" /> Parsing CSV…</>}
          {runStatus === 'uploading' && <><Loader2 className="h-4 w-4 animate-spin" /> Sending to server…</>}
          {runStatus === 'running'   && <><Loader2 className="h-4 w-4 animate-spin" /> Import running…</>}
          {(runStatus === 'idle' || runStatus === 'done' || runStatus === 'error') && (
            mode === 'dry_run' ? 'Run Dry Run (Validate Only)' : `Run ${mode.replace('_', ' ')} Import`
          )}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className={`card p-6 space-y-4 ${result.error ? 'border-red-200' : 'border-green-200'}`}>
          <div className="flex items-center gap-3">
            {result.error || result.status === 'failed'
              ? <XCircle className="h-6 w-6 text-red-500 shrink-0" />
              : <CheckCircle className="h-6 w-6 text-green-500 shrink-0" />}
            <h3 className="font-semibold text-gray-900">
              {result.error ? 'Import Failed' :
               result.status === 'partial' ? 'Import Completed with Errors' :
               mode === 'dry_run' ? 'Dry Run Complete' : 'Import Complete'}
            </h3>
          </div>

          {result.error && <p className="text-sm text-red-700">{result.error}</p>}

          {result.records_scanned !== undefined && (
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Scanned', value: result.records_scanned, color: 'text-gray-900' },
                { label: 'Created', value: result.records_created, color: 'text-green-700' },
                { label: 'Updated', value: result.records_updated, color: 'text-blue-700' },
                { label: 'Failed',  value: result.records_failed,  color: 'text-red-700' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value ?? 0}</p>
                  <p className="text-xs text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {result.error_log && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Error log (first 100):</p>
              <pre className="text-xs text-red-700 bg-red-50 rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                {result.error_log}
              </pre>
            </div>
          )}

          {mode === 'dry_run' && !result.error && (
            <p className="text-sm text-gray-600 bg-blue-50 border border-blue-100 rounded-md p-3">
              Dry run complete. No changes were made. Switch to <strong>Full</strong> mode and run again to commit.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
