import { notFound } from 'next/navigation'
import { getShareLink, touchShareLink } from '@/lib/share-tokens'
import DocumentsSearch from '@/app/(app)/documents/documents-search'

export const dynamic = 'force-dynamic'

// Public, token-gated, read-only document search. No login, no app chrome.
// Data + files are served server-side via the app's own service-role + Graph
// credentials, so the viewer needs neither a CoreDocs account nor SharePoint access.
export default async function ShareDocumentsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await getShareLink(token)
  if (!link || link.kind !== 'documents') notFound()
  touchShareLink(token).catch(() => {})

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-navy-200 bg-navy-700 text-white">
        <div className="mx-auto max-w-6xl px-6 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/coreflow/logo/coreflow-logo-white.png" alt="Coreflow" className="h-7 w-auto shrink-0 object-contain" />
            <span className="h-5 w-px bg-white/25" />
            <span className="font-semibold">CoreDocs</span>
            <span className="opacity-70">· Document Search (shared, read-only preview)</span>
          </div>
          <span className="text-[11px] opacity-70">{link.label ?? 'Reko Diq — Master Document Register'}</span>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <DocumentsSearch apiBase={`/api/share/documents/${token}`} shareMode />
        <p className="mt-8 text-center text-[11px] text-slate-400">
          Shared read-only preview of the Reko Diq master document register. Documents open directly here — no SharePoint access required.
        </p>
      </div>
    </div>
  )
}
