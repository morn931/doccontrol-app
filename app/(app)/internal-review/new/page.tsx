'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Upload, Loader2, FileText } from 'lucide-react'

const DISCIPLINES = ['Electrical','Instrumentation','Automation','Mechanical','Civil','Commercial','Not sure']
const DOC_TYPES   = ['Specification','Drawing','Calculation','Datasheet','Report','Procedure','Template','Letter','Not sure']

export default function NewInternalReviewPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [reviewers, setReviewers] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleSubmit() {
    if (!file) { setError('Choose a file to send for internal review.'); return }
    if (!title.trim()) { setError('Give the document a title.'); return }
    setSubmitting(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title.trim())
      fd.append('discipline', discipline)
      fd.append('documentType', documentType)
      fd.append('recommendedReviewers', reviewers)
      const res = await fetch('/api/internal-review/submit', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Submission failed'); return }
      router.push(`/batches/${data.batchId}`)
    } catch (e: any) {
      setError(e.message ?? 'Unexpected error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/batches" className="btn-secondary text-xs py-1.5 px-3 w-fit"><ArrowLeft className="h-3.5 w-3.5" /> Incoming Batches</Link>

      <div className="card p-6">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-5 w-5 text-teal-600" />
          <h1 className="text-xl font-bold text-slate-900">New Internal Review</h1>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          For internal working documents (Word/Excel/PDF) that aren't from a vendor and don't have a document
          number yet. The file is reviewed in its <strong>native form</strong> (no conversion) and kept in an
          isolated area — it never appears in the SharePoint libraries the site engineers use. Convert / sign /
          issue to Aconex later.
        </p>

        {/* File */}
        <label className="label">Document <span className="text-red-500">*</span></label>
        <div
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer rounded-lg border-2 border-dashed border-slate-300 hover:border-teal-400 p-6 text-center transition-colors">
          <Upload className="h-6 w-6 mx-auto text-slate-400 mb-2" />
          {file ? <span className="text-sm font-medium text-slate-800">{file.name}</span>
                : <span className="text-sm text-slate-500">Click to choose a Word, Excel or PDF file</span>}
          <input ref={fileRef} type="file" className="hidden"
            accept=".doc,.docx,.xls,.xlsx,.pdf"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>

        {/* Title */}
        <label className="label mt-4">Title <span className="text-red-500">*</span></label>
        <input value={title} onChange={e => setTitle(e.target.value)} className="input"
          placeholder="e.g. Manufacturing Clearance — Battery Energy Storage" />

        {/* Discipline + type */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className="label">Discipline</label>
            <select value={discipline} onChange={e => setDiscipline(e.target.value)} className="input">
              <option value="">—</option>
              {DISCIPLINES.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Document type</label>
            <select value={documentType} onChange={e => setDocumentType(e.target.value)} className="input">
              <option value="">—</option>
              {DOC_TYPES.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {/* Recommended reviewers */}
        <label className="label mt-4">Recommend reviewers <span className="text-slate-400 font-normal">(optional)</span></label>
        <textarea value={reviewers} onChange={e => setReviewers(e.target.value)} rows={2} className="input resize-none"
          placeholder="email@ppetech.co.za, another@ppetech.co.za — the controller assigns the final sequence" />
        <p className="mt-1 text-xs text-slate-400">Comma or line separated. These pre-fill the assign step; the controller has the final say.</p>

        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

        <div className="flex gap-3 mt-6">
          <button onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1 justify-center py-2.5">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : <><Upload className="h-4 w-4" /> Send for Internal Review</>}
          </button>
          <Link href="/batches" className="btn-secondary justify-center px-6">Cancel</Link>
        </div>
      </div>
    </div>
  )
}
