'use client'
import { useState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { BATCH_STATUS_LABELS, BATCH_STATUS_COLORS } from '@/lib/utils/batch-status'

export function RecentBatches({ recentBatches }: { recentBatches: any[] | null }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-6 py-4 border-b border-slate-100"
      >
        <div className="flex items-center gap-2">
          <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
          <h2 className="font-semibold text-slate-900">Recent Batches</h2>
        </div>
        <Link href="/batches" onClick={(e) => e.stopPropagation()} className="text-sm text-navy-600 hover:text-navy-800 font-medium">
          View all →
        </Link>
      </button>
      {open && (
        <div className="divide-y divide-slate-50">
          {!recentBatches?.length && (
            <div className="px-6 py-10 text-center text-slate-400">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>No batches yet. Run the import or connect the intake webhook.</p>
            </div>
          )}
          {recentBatches?.map((batch: any) => (
            <Link key={batch.id} href={`/batches/${batch.id}`}
              className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-900 truncate">
                    {batch.packages?.package_name ?? batch.packages?.package_code ?? 'Unknown Package'}
                  </p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${BATCH_STATUS_COLORS[batch.status as keyof typeof BATCH_STATUS_COLORS] ?? 'bg-slate-100 text-slate-600'}`}>
                    {BATCH_STATUS_LABELS[batch.status as keyof typeof BATCH_STATUS_LABELS] ?? batch.status}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {batch.vendors?.name ?? 'Unknown Vendor'} · {batch.file_count} file{batch.file_count !== 1 ? 's' : ''} ·{' '}
                  {formatDistanceToNow(new Date(batch.received_at), { addSuffix: true })}
                </p>
              </div>
              <span className="text-slate-300 text-lg">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
