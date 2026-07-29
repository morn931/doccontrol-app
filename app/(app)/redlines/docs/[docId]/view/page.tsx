'use client'
// Quality-check + extra markup on a DRAFT site redline before submission.
// Reuses the shared PdfMarkup component with the redline endpoints.
import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import PdfMarkup from '@/components/markup/pdf-markup'

export default function RedlineDraftViewPage({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = use(params)
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Link href="/redlines/new" className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to upload
        </Link>
        <p className="text-sm text-slate-500">
          Check the scan is readable. You can add extra markup here — <b>☁ Save to SharePoint</b> bakes it into the file before you submit.
        </p>
      </div>
      <PdfMarkup src={`/api/redlines/docs/${docId}/file`} endpointBase={`/api/redlines/docs/${docId}`}
                 initialColor="#c62828" allowDraftSave={false} />
    </div>
  )
}
