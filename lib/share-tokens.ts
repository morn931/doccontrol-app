import { createServiceClient } from '@/lib/supabase/server'

// DB-backed public share links (migration 025). A valid, non-revoked, non-expired
// row grants read-only access to one surface (`kind`) with no login.

export type ShareLink = {
  token: string
  kind: string
  label: string | null
  shared_with: string | null
  expires_at: string | null
  revoked: boolean
}

/** Returns the link iff it exists, isn't revoked, and hasn't expired — else null. */
export async function getShareLink(token: string): Promise<ShareLink | null> {
  if (!token || token.length < 24) return null
  const db: any = createServiceClient()
  const { data } = await db
    .from('share_link')
    .select('token, kind, label, shared_with, expires_at, revoked')
    .eq('token', token)
    .maybeSingle()
  if (!data || data.revoked) return null
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null
  return data as ShareLink
}

/** Best-effort access stamp (never throws into the request path). */
export async function touchShareLink(token: string): Promise<void> {
  try {
    const db: any = createServiceClient()
    const { data } = await db.from('share_link').select('access_count').eq('token', token).maybeSingle()
    await db.from('share_link').update({
      last_accessed_at: new Date().toISOString(),
      access_count: (data?.access_count ?? 0) + 1,
    }).eq('token', token)
  } catch { /* ignore */ }
}
