// ONE rule for "where is this drawing" across the Prelim pages (landing status list, the
// returns list, the session table). Pure — no imports — so every surface reads the same thing.
export type PrelimStatus = 'not_started' | 'in_review' | 'sent_drawing_office' | 'sent_document_control' | 'sent_lead' | 'returned' | 'ready_for_tender'

export const STATUS_LABEL: Record<PrelimStatus, string> = {
  not_started:         'Not started',
  in_review:           'In review',
  sent_drawing_office: 'Sent to drawing office',
  sent_document_control: 'Sent to document control',
  sent_lead:           'Sent to lead engineer',
  returned:            'Returned from drawing office / document control / lead',
  ready_for_tender:    'Ready for tender',
}
export const STATUS_CLS: Record<PrelimStatus, string> = {
  not_started:         'bg-slate-100 text-slate-600',
  in_review:           'bg-indigo-100 text-indigo-800',
  sent_drawing_office: 'bg-sky-100 text-sky-800',
  sent_document_control: 'bg-indigo-100 text-indigo-800',
  sent_lead:           'bg-amber-100 text-amber-800',
  returned:            'bg-violet-100 text-violet-800',
  ready_for_tender:    'bg-emerald-100 text-emerald-700',
}
export const STATUS_ORDER: PrelimStatus[] = ['not_started', 'in_review', 'sent_drawing_office', 'sent_document_control', 'sent_lead', 'returned', 'ready_for_tender']

export type StatusInput = {
  routing?: string | null
  returned_at?: string | null
  markup_committed_at?: string | null
  markup_layer?: unknown
  markup_comments?: unknown
  outcome?: string | null
  commentCount?: number
  unsavedMarks?: boolean
}

/**
 *   ready_for_tender     the reviewer pressed Ready for tender
 *   sent_*               sent out and not yet back
 *   returned             a corrected file came back and no new call has been made on it
 *   in_review            somebody has worked on it (marks, comments, a room's call) but no call yet
 *   not_started          nothing done
 * A call made AFTER a return outranks the return: the routing columns are cleared when a
 * file comes back, so a non-null routing is always the newer event.
 */
export function prelimStatus(d: StatusInput): PrelimStatus {
  if (d.routing === 'ready_for_tender') return 'ready_for_tender'
  if (d.routing === 'drawing_office') return 'sent_drawing_office'
  if (d.routing === 'document_control') return 'sent_document_control'
  if (d.routing === 'lead') return 'sent_lead'
  if (d.returned_at) return 'returned'
  const marks = d.unsavedMarks ?? !!(d.markup_layer && typeof d.markup_layer === 'object' && Object.keys(d.markup_layer as object).length)
  const comments = d.commentCount ?? (Array.isArray(d.markup_comments) ? d.markup_comments.length : 0)
  if (marks || comments > 0 || d.markup_committed_at || (d.outcome && d.outcome !== 'pending')) return 'in_review'
  return 'not_started'
}

/** Where a drawing was sent / came back from, in words. */
export const FROM_LABEL: Record<string, string> = { drawing_office: 'drawing office', document_control: 'document control', lead: 'lead engineer' }
export const fromLabel = (v: string | null | undefined) => FROM_LABEL[String(v ?? '')] ?? 'drawing office'
