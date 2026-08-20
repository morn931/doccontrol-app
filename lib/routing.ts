import { createServiceClient } from '@/lib/supabase/server'

// Document/batch routing — the collaboration hand-off layer for the Actions
// Cockpit (migration 043). All reads FAIL SOFT (return empty) so the cockpit
// keeps rendering before the migration is applied, or if the table is absent.

export type RoutedItem = {
  id: string
  fromEmail: string
  fromName: string | null
  documentVersionId: string | null
  batchId: string | null
  documentNumber: string | null
  packageCode: string | null
  note: string | null
  status: string
  createdAt: string | null
  firstTaskId: string | null   // resolved review_task to open, when the routed target is a doc/batch of mine
}

export type RoutedToMe = { items: RoutedItem[]; count: number }

export async function getRoutedToMe(email: string): Promise<RoutedToMe> {
  if (!email) return { items: [], count: 0 }
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('document_routing')
      .select('id, from_email, from_name, document_version_id, batch_id, document_number, package_code, note, status, created_at')
      .ilike('to_email', email)
      .in('status', ['open', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(50)
    if (error || !data) return { items: [], count: 0 }

    // Resolve a review_task to open for each routed target (so the recipient lands
    // in the review workspace). Best-effort — a routing without a matching task
    // still shows, just without a deep link.
    const versionIds = [...new Set(data.map((r) => r.document_version_id).filter(Boolean))] as string[]
    const batchIds = [...new Set(data.map((r) => r.batch_id).filter(Boolean))] as string[]
    const taskByVersion = new Map<string, string>()
    const taskByBatch = new Map<string, string>()
    if (versionIds.length) {
      const { data: t } = await db.from('review_tasks')
        .select('id, document_version_id, reviewer_email').in('document_version_id', versionIds).ilike('reviewer_email', email)
      for (const r of t ?? []) if (!taskByVersion.has(r.document_version_id as string)) taskByVersion.set(r.document_version_id as string, r.id as string)
    }
    if (batchIds.length) {
      const { data: t } = await db.from('review_tasks')
        .select('id, batch_id, reviewer_email').in('batch_id', batchIds).ilike('reviewer_email', email)
      for (const r of t ?? []) if (!taskByBatch.has(r.batch_id as string)) taskByBatch.set(r.batch_id as string, r.id as string)
    }

    const items: RoutedItem[] = data.map((r) => ({
      id: r.id as string,
      fromEmail: r.from_email as string,
      fromName: (r.from_name as string) ?? null,
      documentVersionId: (r.document_version_id as string) ?? null,
      batchId: (r.batch_id as string) ?? null,
      documentNumber: (r.document_number as string) ?? null,
      packageCode: (r.package_code as string) ?? null,
      note: (r.note as string) ?? null,
      status: (r.status as string) ?? 'open',
      createdAt: (r.created_at as string) ?? null,
      firstTaskId: (r.document_version_id && taskByVersion.get(r.document_version_id as string))
        || (r.batch_id && taskByBatch.get(r.batch_id as string)) || null,
    }))
    return { items, count: items.length }
  } catch {
    return { items: [], count: 0 }
  }
}

// Small count of routings I've sent that are still open (sender awareness).
export async function getRoutedByMeCount(email: string): Promise<number> {
  if (!email) return 0
  try {
    const db = createServiceClient()
    const { count } = await db.from('document_routing')
      .select('id', { count: 'exact', head: true })
      .ilike('from_email', email).eq('status', 'open')
    return count ?? 0
  } catch {
    return 0
  }
}
