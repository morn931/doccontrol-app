import { createServiceClient } from '@/lib/supabase/server'
import { Inbox, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'
import { BATCH_STATUS_LABELS, BATCH_STATUS_COLORS } from '@/lib/utils/batch-status'
import type { BatchStatus } from '@/lib/types/database'

interface SearchParams { status?: string; q?: string }

function getBatchContextLine(batch: any): string | null {
  const status = batch.status as BatchStatus
  if (status === 'intake_received' || status === 'metadata_pending') {
    return 'Document control action needed'
  }
  if (status === 'ready_for_reviewer_assignment') {
    return 'Awaiting reviewer assignment'
  }
  if (status === 'review_ready_to_start') {
    return 'Awaiting document controller to start review'
  }
  if (status === 'review_in_progress') {
    const tasks: any[] = batch.review_tasks ?? []
    const active = tasks.filter((t: any) => ['sent', 'opened', 'in_progress'].includes(t.status))
    if (!active.length) return null
    const minSeq = Math.min(...active.map((t: any) => t.sequence_number))
    const names = [...new Set(
      active
        .filter((t: any) => t.sequence_number === minSeq)
        .map((t: any) => (t.reviewer_email as string).split('@')[0])
    )] as string[]
    if (names.length === 1) return `Being reviewed by ${names[0]}`
    if (names.length === 2) return `Being reviewed by ${names[0]} and ${names[1]}`
    return `Being reviewed by ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }
  if (status === 'review_complete') return 'Ready to generate transmittal'
  if (status === 'transmittal_generated') return 'Transmittal generated — awaiting return'
  if (status === 'returned_to_vendor') return 'Returned to vendor'
  return null
}

async function getBatches(params: SearchParams) {
  const db = createServiceClient()
  let query = db
    .from('batches')
    .select(`id, batch_guid, status, file_count, received_at, rejected_at,
             comments, vendor_email,
             vendors(name, code), packages(package_code, package_name),
             review_tasks(reviewer_email, sequence_number, status)`)
    .order('received_at', { ascending: false })
    .limit(100)

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
  return { batches: data ?? [], error }
}

const FILTER_TABS = [
  { key: 'all',       label: 'All Batches' },
  { key: 'pending',   label: 'Awaiting Action' },
  { key: 'in_review', label: 'In Review' },
  { key: 'complete',  label: 'Ready to Return' },
  { key: 'returned',  label: 'Returned' },
  { key: 'rejected',  label: 'Rejected' },
]

export default async function BatchesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const activeTab = params.status ?? 'all'
  const { batches, error } = await getBatches(params)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Incoming Batches</h1>
          <p className="text-gray-500 text-sm mt-1">Document batches received from vendors</p>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {FILTER_TABS.map(tab => (
          <Link key={tab.key}
            href={`/batches${tab.key === 'all' ? '' : `?status=${tab.key}`}`}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}>
            {tab.label}
          </Link>
        ))}
      </div>

      {error && (
        <div className="card p-4 text-red-700 bg-red-50">Error loading batches: {error.message}</div>
      )}

      <div className="card divide-y divide-gray-50">
        {!batches.length ? (
          <div className="py-16 text-center text-gray-400">
            <Inbox className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No batches found</p>
            <p className="text-sm mt-1">Run the import to load existing SharePoint data.</p>
            <Link href="/admin/import" className="btn-primary mt-4 inline-flex">
              Go to Import
            </Link>
          </div>
        ) : (
          batches.map((batch: any) => (
            <Link key={batch.id} href={`/batches/${batch.id}`}
              className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 truncate">
                    {batch.packages?.package_name ?? batch.packages?.package_code ?? 'Unknown Package'}
                  </p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${BATCH_STATUS_COLORS[batch.status as BatchStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                    {BATCH_STATUS_LABELS[batch.status as BatchStatus] ?? batch.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm text-gray-500">
                  <span>{batch.vendors?.name ?? 'Unknown Vendor'}</span>
                  <span>· {batch.file_count} file{batch.file_count !== 1 ? 's' : ''}</span>
                  <span>· Received {formatDistanceToNow(new Date(batch.received_at), { addSuffix: true })}</span>
                  {batch.vendor_email && <span>· {batch.vendor_email}</span>}
                </div>
                {getBatchContextLine(batch) && (
                  <p className="text-xs text-indigo-500 mt-1">{getBatchContextLine(batch)}</p>
                )}
                {batch.comments && (
                  <p className="text-xs text-gray-400 mt-1 truncate">{batch.comments}</p>
                )}
              </div>
              <div className="text-xs font-mono text-gray-400 shrink-0 text-right">
                <div>{format(new Date(batch.received_at), 'd MMM yyyy')}</div>
                <div className="text-gray-300">{batch.batch_guid?.slice(0,8)}…</div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
