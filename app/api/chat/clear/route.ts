import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isChatAdmin } from '@/lib/chat-perms'

// Clear the Engineering Room — deletes every message in the room and its stored
// images. Restricted to the chat admins (Marnus / Morné / Liezl), verified here
// server-side. Irreversible.
const ROOM = 'engineering'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email').eq('auth_user_id', user.id).single()
  if (!isChatAdmin(profile?.email as string)) {
    return NextResponse.json({ error: 'Only Marnus, Morné or Liezl can clear the room.' }, { status: 403 })
  }
  try {
    // best-effort: remove the room's stored images
    const { data: files } = await db.storage.from('chat-uploads').list('engineering', { limit: 1000 })
    if (files?.length) await db.storage.from('chat-uploads').remove(files.map((f) => `engineering/${f.name}`))
  } catch { /* ignore storage cleanup errors */ }
  const { error } = await db.from('chat_message').delete().eq('room', ROOM)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
