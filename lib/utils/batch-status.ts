import type { BatchStatus } from '@/lib/types/database'

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  intake_received:              'Received',
  metadata_pending:             'Metadata Pending',
  ready_for_reviewer_assignment:'Ready to Assign',
  review_ready_to_start:        'Ready to Start',
  review_in_progress:           'In Review',
  review_complete:              'Review Complete',
  transmittal_generated:        'Transmittal Generated',
  returned_to_vendor:           'Returned to Vendor',
  rejected_before_review:       'Rejected',
  cancelled:                    'Cancelled',
  failed:                       'Failed',
}

export const BATCH_STATUS_COLORS: Record<BatchStatus, string> = {
  intake_received:              'bg-blue-100 text-blue-800',
  metadata_pending:             'bg-yellow-100 text-yellow-800',
  ready_for_reviewer_assignment:'bg-indigo-100 text-indigo-800',
  review_ready_to_start:        'bg-purple-100 text-purple-800',
  review_in_progress:           'bg-orange-100 text-orange-800',
  review_complete:              'bg-teal-100 text-teal-800',
  transmittal_generated:        'bg-cyan-100 text-cyan-800',
  returned_to_vendor:           'bg-green-100 text-green-800',
  rejected_before_review:       'bg-red-100 text-red-800',
  cancelled:                    'bg-gray-100 text-gray-600',
  failed:                       'bg-red-200 text-red-900',
}
