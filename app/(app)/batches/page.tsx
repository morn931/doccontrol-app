import { createServiceClient } from '@/lib/supabase/server'
import { Inbox } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'
import { BATCH_STATUS_LABELS, BATCH_STATUS_COLORS } from '@/lib/utils/batch-status'
import type { BatchStatus } from '@/lib/types/database'

interface SearchParams { status?: string; q?: string }

// ─── Reviewer chain helpers ────────────────────────────────────────────────

function displayName(email: string, nameMap: Record<string, string>): string {
  const full = nameMap[email]
  if (full) return full.split(' ')[0]            // first name only
  return email.split('@')[0]                      // email prefix fallback
}

function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

interface ReviewChain {
  active:    string[]   // currently reviewing
  done:      string[]   // fully completed all their tasks
  pending:   string[]   // not yet started (all tasks pending)
  isFinal:   boolean    // active reviewer is the last in the chain
}

function getReviewChain(batch: any, nameMap: Record<string, string>): ReviewChain | null {
  const tasks: any[] = batch.review_tasks ?? []
  if (!tasks.length) return null

  // Group by sequence_number, collect unique emails and all statuses
  const bySeq: Record<number, { emails: Set<string>; statuses: string[] }> = {}
  for (const t of tasks) {
    const s = t.sequence_number as number
    if (!bySeq[s]) bySeq[s] = { emails: new Set(), statuses: [] }
    bySeq[s].emails.add(t.reviewer_email as string)
    bySeq[s].statuses.push(t.status as string)
  }

  const seqs = Object.keys(bySeq).map(Number).sort((a, b) => a - b)

  const active:  string[] = []
  const done:    string[] = []
  const pending: string[] = []

  for (const seq of seqs) {
    const { emails, statuses } = bySeq[seq]
    const names = [...emails].map(e => displayName(e, nameMap))
    const allDone   = statuses.every(s => s === 'completed')
    const hasActive = statuses.some(s => ['sent', 'opened', 'in_progress'].includes(s))
    const allPending = statuses.every(s => s === 'pending')

    if (allDone)        done.push(...names)
    else if (hasActive) active.push(...names)
    else if (allPending) pending.push(...names)
    else                active.push(...names)   // mixed: still in flight
  }

  // isFinal: no pending reviewers left after the current active ones
  const isFinal = pending.length === 0

  return { active, done, pending, isFinal }
}

// ─── Context rendering ─────────────────────────────────────────────────────

function BatchReviewChain({ chain }: { chain: ReviewChain }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs">
      {chain.active.length > 0 && (
        <span className="text-amber-600 font-medium">
          With {joinNames(chain.active)}
        </span>
      )}
      {chain.done.length > 0 && (
        <span className="text-emerald-600">
          ✓ {joinNames(chain.done)} reviewed
        </span>
      )}
      {chain.pending.length > 0 ? (
        <span className="text-slate-400">
          → {joinNames(chain.pending)} still to review
        </span>
      ) : chain.active.length > 0 && (
        <span className="text-slate-400 italic">
          No more reviews after this
        </span>
      )}
    </div>
  )
}

function getBatchContextLine(batch: any): string | null {
  const status = batch.status as BatchStatus
  if (status === 'intake_received' || status === 'metadata_pending')
    return 'Document control action needed'
  if (status === 'ready_for_reviewer_assignment')
    return 'Awaiting reviewer assignment'
  if (status === 'review_ready_to_start')
    return 'Awaiting document controller to start review'
  if (status === 'review_complete')
    return 'Ready to generate transmittal'
  if (status === 'transmittal_generated')
    return 'Transmittal generated — awaiting return'
  if (status === 'returned_to_vendor')
    return 'Returned to vendor'
  return null
}

// ─── Data fetching ─────────────────────────────────────────────────────────

async function getBatches(params: SearchParams) {
  const db = createServiceClient()
  const q = (params.q ?? '').trim().toLowerCase()
  let query = db
    .from('batches')
    .select(`id, batch_guid, status, source, file_count, received_at, rejected_at,
             comments, vendor_email,
             vendors(name, code), packages(package_code, package_name),
             document_versions(revision, doc_name, file_name, documents(display_document_number, normalized_document_number)),
             review_tasks(reviewer_email, sequence_number, status, due_date)`)
    .order('received_at', { ascending: false })
    .limit(q ? 500 : 100)

  if (params.status && params.status !== 'all') {
    const statusMap: Record<string, BatchStatus[]> = {
      pending:    ['intake_received','metadata_pending','ready_for_reviewer_assignment'],
      in_review:  ['review_in_progress','review_ready_to_start'],
      complete:   ['review_complete','transmittal_generated'],
      returned:   ['returned_to_vendor'],
      rejected:   ['rejected_before_review'],
    }
    const statuses = statusMap[params.status]
    if (statuses) query = query.in('status', statuses)
  }

  const { data, error } = await query
  let rows = data ?? []
  // Free-text search across package, vendor and batch id (in-memory — the join
  // columns live on embedded resources; the raised limit keeps matches in scope).
  if (q) {
    rows = rows.filter((b: any) =>
      (b.packages?.package_code ?? '').toLowerCase().includes(q) ||
      (b.packages?.package_name ?? '').toLowerCase().includes(q) ||
      (b.vendors?.name ?? '').toLowerCase().includes(q) ||
      (b.vendor_email ?? '').toLowerCase().includes(q) ||
      (b.batch_guid ?? '').toLowerCase().includes(q))
  }
  return { batches: rows, error }
}

const FILTER_TABS = [
  { key: 'all',       label: 'All Batches' },
  { key: 'pending',   label: 'Awaiting Action' },
  { key: 'in_review', label: 'In Review' },
  { key: 'complete',  label: 'Ready to Return' },
  { key: 'returned',  label: 'Returned' },
  { key: 'rejected',  label: 'Rejected' },
]

// ─── Page ──────────────────────────────────────────────────────────────────

export default async function BatchesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const activeTab = params.status ?? 'all'
  const { batches, error } = await getBatches(params)
  const now = new Date()
  const OPEN_TASK = ['pending', 'sent', 'opened', 'in_progress', 'overdue']

  // Fetch display names for all reviewer emails seen in this page's batches
  const allEmails = [...new Set(
    batches.flatMap((b: any) => (b.review_tasks ?? []).map((t: any) => t.reviewer_email as string))
  )]
  const nameMap: Record<string, string> = {}
  if (allEmails.length) {
    const db = createServiceClient()
    const { data: users } = await db
      .from('users')
      .select('email, full_name')
      .in('email', allEmails)
    for (const u of users ?? []) {
      if (u.email && u.full_name) nameMap[u.email] = u.full_name
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Incoming Batches</h1>
          <p className="text-slate-500 text-sm mt-1">Document batches received from vendors</p>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit flex-wrap">
        {FILTER_TABS.map(tab => (
          <Link key={tab.key}
            href={`/batches${tab.key === 'all' ? '' : `?status=${tab.key}`}`}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}>
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Package / vendor / batch search */}
      <form method="get" className="flex items-center gap-2">
        {activeTab !== 'all' && <input type="hidden" name="status" value={activeTab} />}
        <input name="q" defaultValue={params.q ?? ''} placeholder="Search package, vendor or batch…"
          className="input text-sm max-w-xs" />
        <button type="submit" className="btn-secondary text-sm py-2">Search</button>
        {params.q && (
          <Link href={`/batches${activeTab !== 'all' ? `?status=${activeTab}` : ''}`}
            className="text-sm text-slate-500 hover:text-slate-800">Clear</Link>
        )}
        {params.q && (
          <span className="text-xs text-slate-400">{batches.length} result{batches.length !== 1 ? 's' : ''} for &ldquo;{params.q}&rdquo;</span>
        )}
      </form>

      {error && (
        <div className="card p-4 text-red-700 bg-red-50">Error loading batches: {error.message}</div>
      )}

      <div className="card divide-y divide-slate-50">
        {!batches.length ? (
          <div className="py-16 text-center text-slate-400">
            <Inbox className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No batches found</p>
            <p className="text-sm mt-1">Run the import to load existing SharePoint data.</p>
            <Link href="/admin/import" className="btn-primary mt-4 inline-flex">
              Go to Import
            </Link>
          </div>
        ) : (
          batches.map((batch: any) => {
            const isInReview = (batch.status as BatchStatus) === 'review_in_progress'
            const chain = isInReview ? getReviewChain(batch, nameMap) : null
            const contextLine = getBatchContextLine(batch)
            const isOverdue = ['review_in_progress', 'review_ready_to_start'].includes(batch.status)
              && (batch.review_tasks ?? []).some((t: any) =>
                   t.due_date && new Date(t.due_date) < now && OPEN_TASK.includes(t.status))

            // Internal-engineering batches carry no vendor/package — surface the document
            // metadata (from the linked Document Request line) instead of "Unknown …".
            const isInternal = batch.source === 'internal'
            const dv = (batch.document_versions ?? [])[0]
            const docNo = dv?.documents?.display_document_number ?? dv?.documents?.normalized_document_number
              ?? dv?.file_name?.replace(/\.[^.]+$/, '') ?? null
            const primaryTitle = isInternal
              ? (docNo ?? 'Internal document')
              : (batch.packages?.package_name ?? batch.packages?.package_code ?? 'Unknown Package')
            const originLabel = isInternal ? 'PPE Internal Engineering' : (batch.vendors?.name ?? 'Unknown Vendor')
            const internalTitle = isInternal ? (dv?.doc_name ?? null) : null
            const internalRev = isInternal ? (dv?.revision ?? null) : null

            return (
              <Link key={batch.id} href={`/batches/${batch.id}`}
                className="flex items-start gap-4 px-6 py-4 hover:bg-slate-50 transition-colors group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900 truncate">
                      {primaryTitle}
                    </p>
                    {isInternal && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
                        Internal
                      </span>
                    )}
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${BATCH_STATUS_COLORS[batch.status as BatchStatus] ?? 'bg-slate-100 text-slate-600'}`}>
                      {BATCH_STATUS_LABELS[batch.status as BatchStatus] ?? batch.status}
                    </span>
                    {isOverdue && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        ⚠ Overdue
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm text-slate-500">
                    <span>{originLabel}</span>
                    {isInternal && internalTitle && <span className="truncate max-w-xs">· {internalTitle}</span>}
                    {isInternal && internalRev && <span>· Rev {internalRev}</span>}
                    <span>· {batch.file_count} file{batch.file_count !== 1 ? 's' : ''}</span>
                    <span>· Received {formatDistanceToNow(new Date(batch.received_at), { addSuffix: true })}</span>
                    {!isInternal && batch.vendor_email && <span>· {batch.vendor_email}</span>}
                  </div>
                  {chain && <BatchReviewChain chain={chain} />}
                  {!chain && contextLine && (
                    <p className="text-xs text-indigo-500 mt-1">{contextLine}</p>
                  )}
                  {batch.comments && (
                    <p className="text-xs text-slate-400 mt-1 truncate">{batch.comments}</p>
                  )}
                </div>
                <div className="text-xs font-mono text-slate-400 shrink-0 text-right">
                  <div>{format(new Date(batch.received_at), 'd MMM yyyy')}</div>
                  <div className="text-slate-300">{batch.batch_guid?.slice(0,8)}…</div>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
