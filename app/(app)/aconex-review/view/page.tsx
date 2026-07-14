import Link from 'next/link'
import { ArrowLeft, Download, ExternalLink, FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Branded viewer for an Aconex registered document — streamed through CoreDocs so the
// user never has to log into Aconex. `?doc=<AconexDocumentId>&name=<docno>&markedup=1`.
export default async function AconexViewPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; name?: string; markedup?: string }>
}) {
  const sp = await searchParams
  const doc = sp.doc ?? ''
  const name = sp.name ?? 'Document'
  const markedup = sp.markedup === '1'
  const src = `/api/aconex/document?doc=${encodeURIComponent(doc)}&markedup=${markedup ? '1' : '0'}`

  if (!doc) {
    return <div className="card p-6 text-sm text-slate-500">No document specified.</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/aconex-review" className="text-slate-500 hover:text-slate-800 shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <FileText className="h-5 w-5 text-navy-600 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-slate-800 font-mono text-sm truncate">{name}</div>
            <div className="text-xs text-slate-400 flex items-center gap-1">
              <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-[10px] font-semibold px-1.5 py-0.5 border border-orange-200">
                ACONEX
              </span>
              {markedup ? 'Marked-up review copy' : 'Current document'} · streamed live
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/aconex-review/view?doc=${encodeURIComponent(doc)}&name=${encodeURIComponent(name)}&markedup=${markedup ? '0' : '1'}`}
            className="text-xs rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
          >
            {markedup ? 'View clean copy' : 'View marked-up copy'}
          </Link>
          <a
            href={src}
            download
            className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
          <a
            href="https://eu1.aconex.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
          >
            Aconex <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="card overflow-hidden" style={{ height: 'calc(100vh - 190px)' }}>
        <iframe src={src} title={name} className="w-full h-full" />
      </div>
      <p className="text-xs text-slate-400">
        If the document doesn’t display (non-PDF file type), use <strong>Download</strong> to open it.
      </p>
    </div>
  )
}
