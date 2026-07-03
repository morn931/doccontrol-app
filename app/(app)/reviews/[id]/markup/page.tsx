import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import PdfMarkup from '@/components/markup/pdf-markup'
import ReviewerNotes from '@/components/markup/reviewer-notes'

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
  const { data: task } = await db.from('review_tasks')
    .select('id, sequence_number, document_versions(id, file_name, doc_name)')
    .eq('id', id).single()
  const dv = (task as any)?.document_versions
  if (!task || !dv) redirect('/reviews')

  // Per-reviewer colour, keyed by review sequence, so accumulated mark-ups are
  // visually attributable down the chain.
  const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5']
  const reviewerColor = PALETTE[(((task as any).sequence_number ?? 1) - 1) % PALETTE.length]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/reviews/${id}`} className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to review
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-600 px-2.5 py-0.5 text-xs font-medium">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: reviewerColor }} /> Your review colour
        </span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{dv.doc_name ?? dv.file_name}</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          Loaded live from SharePoint. Mark up the document, then <b>☁ Save to SharePoint</b> so the next reviewer sees your notes.
        </p>
      </div>
      <ReviewerNotes reviewTaskId={id} />
      <PdfMarkup src={`/api/documents/${dv.id}/file`} fileName={(dv.file_name ?? 'document').replace(/\.pdf$/i, '')} reviewTaskId={id} initialColor={reviewerColor} />
    </div>
  )
}
