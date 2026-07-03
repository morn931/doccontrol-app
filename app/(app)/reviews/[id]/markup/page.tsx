import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import PdfMarkup from '@/components/markup/pdf-markup'

export const dynamic = 'force-dynamic'

// Phase 1 — in-app markup wired to a real review, PDF streamed live from SharePoint.
// Beta: admin / document_controller only. No save-back yet (Phase 3) — Flatten &
// download proves the output. The classic "Open in SharePoint" flow is untouched.
export default async function ReviewMarkupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('role').eq('auth_user_id', user.id).single()
  if (!['admin', 'document_controller'].includes((profile as any)?.role ?? '')) redirect('/reviews')

  const { data: task } = await db.from('review_tasks')
    .select('id, document_versions(id, file_name, doc_name)')
    .eq('id', id).single()
  const dv = (task as any)?.document_versions
  if (!task || !dv) redirect('/reviews')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/reviews/${id}`} className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to review
        </Link>
        <span className="rounded-full bg-amber-100 text-amber-700 px-2.5 py-0.5 text-xs font-semibold">In-app markup · Beta</span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{dv.doc_name ?? dv.file_name}</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          Loaded live from SharePoint. Mark-ups aren&apos;t saved back yet (that&apos;s Phase 3) — use <b>Flatten &amp; download</b> to check the output.
        </p>
      </div>
      <PdfMarkup src={`/api/documents/${dv.id}/file`} fileName={(dv.file_name ?? 'document').replace(/\.pdf$/i, '')} />
    </div>
  )
}
