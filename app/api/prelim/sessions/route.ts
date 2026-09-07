import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { prelimAuth, isErr, PRELIM_SOURCE_SITE_URL, PRELIM_SOURCE_LIBRARY } from '@/lib/prelim'

// Open a prelim session: which source folder the room is reviewing, when, who is there.
export async function POST(req: Request) {
  const auth = await prelimAuth('manage'); if (isErr(auth)) return auth
  const body = await req.json().catch(() => ({}))
  const title = String(body?.title ?? '').trim()
  if (!title) return NextResponse.json({ error: 'Give the session a title.' }, { status: 400 })
  const db = createServiceClient()
  const { data, error } = await db.from('prelim_session').insert({
    title,
    area:             String(body?.area ?? '').trim() || null,
    source_site_url:  String(body?.site ?? '').trim() || PRELIM_SOURCE_SITE_URL,
    source_library:   String(body?.library ?? '').trim() || PRELIM_SOURCE_LIBRARY,
    source_folder:    String(body?.folder ?? '').replace(/\.\./g, '').replace(/^\/+|\/+$/g, ''),
    held_on:          body?.heldOn ? String(body.heldOn).slice(0, 10) : null,
    attendees:        String(body?.attendees ?? '').trim() || null,
    notes:            String(body?.notes ?? '').trim() || null,
    created_by_email: auth.email,
    created_by_name:  auth.name,
  }).select('id').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not open the session.' }, { status: 500 })
  await db.from('audit_events').insert({
    entity_type: 'prelim_session', entity_id: (data as any).id, event_type: 'prelim_session_opened',
    actor_user_id: auth.userId, actor_email: auth.email, event_data: { title },
  }).then(() => null, () => null)
  return NextResponse.json({ id: (data as any).id }, { status: 201 })
}
