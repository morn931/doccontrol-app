import { createServiceClient } from '@/lib/supabase/server'
import { getGoLiveCutover } from '@/lib/golive'
import { ACTIONABLE_REVIEW_STATUSES } from '@/lib/utils/review-status'

// ─────────────────────────────────────────────────────────────────────────────
// Engineer Actions Cockpit — data layer (Phase 1, "assembly" panels).
// Aggregates existing CoreDocs engines into one personal landing view:
//   • Review Queue        — batches assigned to me I haven't started
//   • Reviews in Progress — batches I've begun, per-document status
//   • My Action Items     — engineering_action assigned to me, still open
// Time & Leave is a separate (cross-database) panel handled by the page.
// Reuses the SAME review_tasks definitions as /reviews so counts never drift.
// Every read fails soft — one slow source can't blank the landing page.
// ─────────────────────────────────────────────────────────────────────────────

export type CockpitDoc = {
  taskId: string
  versionId: string | null
  label: string
  revision: string | null
  status: string
  outcome: string | null
}

export type CockpitBatch = {
  key: string
  packageName: string
  vendorName: string | null
  seq: number
  docCount: number
  reviewedCount: number
  firstTaskId: string
  earliestDue: string | null
  latestSent: string | null
  isOverdue: boolean
  inProgress: boolean
  docs: CockpitDoc[]
}

export type CockpitAction = {
  id: string
  ref: string | null
  title: string
  source: string | null
  priority: string | null
  dueDate: string | null
  documentNumber: string | null
}

export type CockpitData = {
  reviewQueue: CockpitBatch[]
  inProgress: CockpitBatch[]
  actions: CockpitAction[]
  counts: {
    queueBatches: number
    queueDocs: number
    inProgressBatches: number
    actionsOpen: number
    overdue: number
    queued: number
  }
}

const EMPTY: CockpitData = {
  reviewQueue: [], inProgress: [], actions: [],
  counts: { queueBatches: 0, queueDocs: 0, inProgressBatches: 0, actionsOpen: 0, overdue: 0, queued: 0 },
}

// Same shape as /reviews TASK_SELECT so the grouping matches exactly.
const TASK_SELECT = `
  id, status, sequence_number, date_sent, date_completed, due_date,
  review_outcome_code, batch_id, document_version_id,
  document_versions(
    id, file_name, doc_name, revision, discipline,
    documents!document_versions_document_id_fkey(id, normalized_document_number)
  ),
  batches!inner(id, batch_guid, received_at, packages(package_code, package_name), vendors(name))
`

const SEVERITY: Record<string, number> = { A1: 1, D1: 2, B1: 3, B2: 4, C1: 5, Q1: 6, V1: 7, S1: 8 }

// Overdue first, then soonest due, then most recently sent.
function byUrgency(a: CockpitBatch, b: CockpitBatch): number {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
  if (a.earliestDue && b.earliestDue && a.earliestDue !== b.earliestDue) return a.earliestDue < b.earliestDue ? -1 : 1
  if (a.earliestDue && !b.earliestDue) return -1
  if (!a.earliestDue && b.earliestDue) return 1
  return (b.latestSent ?? '').localeCompare(a.latestSent ?? '')
}

export async function getCockpitData(email: string): Promise<CockpitData> {
  if (!email) return EMPTY
  try {
    const db = createServiceClient()
    const cutover = await getGoLiveCutover(db)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withCutover = (q: any) => (cutover ? q.gte('batches.received_at', cutover) : q)

    const [{ data: active }, { data: completed }, { count: queued }, { data: actionRows }] = await Promise.all([
      withCutover(db.from('review_tasks').select(TASK_SELECT)
        .eq('reviewer_email', email).in('status', ACTIONABLE_REVIEW_STATUSES))
        .order('date_sent', { ascending: false, nullsFirst: false }).limit(500),
      withCutover(db.from('review_tasks').select(TASK_SELECT)
        .eq('reviewer_email', email).eq('status', 'completed'))
        .order('date_completed', { ascending: false, nullsFirst: false }).limit(300),
      withCutover(db.from('review_tasks').select('*, batches!inner(received_at)', { count: 'exact', head: true })
        .eq('reviewer_email', email).eq('status', 'pending')),
      db.from('engineering_action')
        .select('id, action_ref, title, source, priority, due_date, status, document_number')
        .eq('assigned_to_email', email).in('status', ['open', 'in_progress']).eq('suggested', false)
        .order('due_date', { ascending: true, nullsFirst: false }).limit(50),
    ])

    // Group my tasks by batch — the batch is the unit of work.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = new Map<string, { tasks: any[]; batch: any }>()
    for (const t of [...(active ?? []), ...(completed ?? [])]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tt = t as any
      const key = tt.batch_id ?? 'no-batch'
      if (!map.has(key)) map.set(key, { tasks: [], batch: tt.batches })
      map.get(key)!.tasks.push(tt)
    }

    const now = Date.now()
    const reviewQueue: CockpitBatch[] = []
    const inProgress: CockpitBatch[] = []
    let overdue = 0

    for (const [key, { tasks: bt, batch }] of map) {
      const started = bt.some((t) => t.status === 'in_progress' || t.status === 'completed')
      const allComplete = bt.every((t) => t.status === 'completed')
      const inProg = bt.some((t) => t.status === 'in_progress')
      const isOverdue = bt.some((t) => t.due_date && new Date(t.due_date).getTime() < now && t.status !== 'completed')
      if (isOverdue) overdue++
      const due = bt.map((t) => t.due_date).filter(Boolean).sort()
      const sent = bt.map((t) => t.date_sent).filter(Boolean).sort()
      const first = bt.find((t) => ['in_progress', 'sent', 'opened', 'overdue'].includes(t.status)) ?? bt[0]
      const docs: CockpitDoc[] = bt.map((t) => {
        const dv = t.document_versions
        return {
          taskId: t.id,
          versionId: (t.document_version_id as string) ?? dv?.id ?? null,
          label: dv?.documents?.normalized_document_number ?? dv?.file_name ?? 'Document',
          revision: dv?.revision ?? null,
          status: t.status,
          outcome: t.review_outcome_code ?? null,
        }
      }).sort((a, b) => (SEVERITY[b.outcome ?? ''] ?? 0) - (SEVERITY[a.outcome ?? ''] ?? 0))

      const group: CockpitBatch = {
        key,
        packageName: batch?.packages?.package_name ?? batch?.packages?.package_code ?? 'Unknown package',
        vendorName: batch?.vendors?.name ?? null,
        seq: bt[0]?.sequence_number ?? 1,
        docCount: bt.length,
        reviewedCount: bt.filter((t) => t.status === 'completed').length,
        firstTaskId: first?.id ?? bt[0]?.id,
        earliestDue: due[0] ?? null,
        latestSent: sent[sent.length - 1] ?? null,
        isOverdue,
        inProgress: inProg,
        docs,
      }
      if (allComplete) continue           // fully reviewed → not shown on the cockpit
      if (started) inProgress.push(group)  // I've begun this batch
      else reviewQueue.push(group)         // assigned, not yet started
    }

    reviewQueue.sort(byUrgency)
    inProgress.sort(byUrgency)

    const actions: CockpitAction[] = (actionRows ?? []).map((a) => ({
      id: a.id as string,
      ref: (a.action_ref as string) ?? null,
      title: (a.title as string) ?? (a.document_number as string) ?? 'Action',
      source: (a.source as string) ?? null,
      priority: (a.priority as string) ?? null,
      dueDate: (a.due_date as string) ?? null,
      documentNumber: (a.document_number as string) ?? null,
    }))

    return {
      reviewQueue, inProgress, actions,
      counts: {
        queueBatches: reviewQueue.length,
        queueDocs: reviewQueue.reduce((s, g) => s + g.docCount, 0),
        inProgressBatches: inProgress.length,
        actionsOpen: actions.length,
        overdue,
        queued: queued ?? 0,
      },
    }
  } catch {
    return EMPTY
  }
}
