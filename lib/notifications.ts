import { createServiceClient } from '@/lib/supabase/server'
import { ACTIONABLE_REVIEW_STATUSES } from '@/lib/utils/review-status'

// In-screen notifications (migration 044). A unified feed MATERIALISED from the
// work sources on read — so no assignment site needs instrumenting: whenever a
// user loads a page, their bell fetch (getNotifications) reconciles the feed with
// their current routings / review tasks / actions via an insert-or-ignore keyed
// on a stable source_key, preserving read state. Everything fails soft so the app
// keeps working before migration 044 is applied.

export type Notif = {
  id: string
  type: 'routing' | 'review' | 'action' | 'message' | string
  title: string
  body: string | null
  href: string | null
  read: boolean
  createdAt: string | null
}

export type NotifFeed = { items: Notif[]; unread: number }

type Insert = { user_email: string; type: string; title: string; body: string | null; href: string | null; source_key: string; created_at?: string }

async function materialise(db: ReturnType<typeof createServiceClient>, email: string): Promise<void> {
  const rows: Insert[] = []

  const { data: routings } = await db.from('document_routing')
    .select('id, from_name, from_email, document_number, batch_id, note, created_at')
    .ilike('to_email', email).in('status', ['open', 'accepted']).order('created_at', { ascending: false }).limit(50)
  for (const r of routings ?? []) {
    const who = (r.from_name as string) ?? (r.from_email as string) ?? 'A colleague'
    const what = (r.document_number as string) ?? (r.batch_id ? 'a batch' : 'a document')
    rows.push({ user_email: email, type: 'routing', source_key: `routing:${r.id}`,
      title: `${who} routed you ${what}`, body: (r.note as string) ?? null, href: '/home', created_at: (r.created_at as string) ?? undefined })
  }

  const { data: tasks } = await db.from('review_tasks')
    .select('id, date_sent, document_versions(file_name, documents!document_versions_document_id_fkey(normalized_document_number))')
    .ilike('reviewer_email', email).in('status', ACTIONABLE_REVIEW_STATUSES)
    .order('date_sent', { ascending: false, nullsFirst: false }).limit(80)
  for (const t of tasks ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dv = (t as any).document_versions
    const label = dv?.documents?.normalized_document_number ?? dv?.file_name ?? 'a document'
    rows.push({ user_email: email, type: 'review', source_key: `review:${t.id}`,
      title: `Review needed — ${label}`, body: null, href: `/reviews/${t.id}`, created_at: (t.date_sent as string) ?? undefined })
  }

  const { data: acts } = await db.from('engineering_action')
    .select('id, title, action_ref, created_at').ilike('assigned_to_email', email)
    .in('status', ['open', 'in_progress']).eq('suggested', false).order('created_at', { ascending: false }).limit(80)
  for (const a of acts ?? []) {
    rows.push({ user_email: email, type: 'action', source_key: `action:${a.id}`,
      title: `Action item — ${(a.title as string) ?? (a.action_ref as string) ?? 'assigned to you'}`, body: null, href: '/engineering-actions', created_at: (a.created_at as string) ?? undefined })
  }

  if (rows.length) {
    // insert-or-ignore on (user_email, source_key) — never disturbs read_at
    await db.from('notification').upsert(rows, { onConflict: 'user_email,source_key', ignoreDuplicates: true })
  }
}

export async function getNotifications(email: string): Promise<NotifFeed> {
  if (!email) return { items: [], unread: 0 }
  try {
    const db = createServiceClient()
    await materialise(db, email)
    const [{ data }, { count }] = await Promise.all([
      db.from('notification').select('id, type, title, body, href, read_at, created_at')
        .ilike('user_email', email).order('created_at', { ascending: false }).limit(40),
      db.from('notification').select('id', { count: 'exact', head: true }).ilike('user_email', email).is('read_at', null),
    ])
    const items: Notif[] = (data ?? []).map((n) => ({
      id: n.id as string, type: (n.type as string), title: n.title as string,
      body: (n.body as string) ?? null, href: (n.href as string) ?? null,
      read: !!n.read_at, createdAt: (n.created_at as string) ?? null,
    }))
    return { items, unread: count ?? 0 }
  } catch {
    return { items: [], unread: 0 }
  }
}

export async function markNotificationsRead(email: string, opts: { ids?: string[]; all?: boolean }): Promise<{ ok: boolean }> {
  if (!email) return { ok: false }
  try {
    const db = createServiceClient()
    let q = db.from('notification').update({ read_at: new Date().toISOString() }).ilike('user_email', email).is('read_at', null)
    if (!opts.all) q = q.in('id', opts.ids ?? [])
    await q
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// Called when the recipient acts on a routing in the cockpit panel, to keep the
// bell in step. Best-effort (table may not exist yet).
export async function markRoutingNotificationRead(email: string, routingId: string): Promise<void> {
  try {
    await createServiceClient().from('notification')
      .update({ read_at: new Date().toISOString() })
      .ilike('user_email', email).eq('source_key', `routing:${routingId}`)
  } catch { /* ignore */ }
}
