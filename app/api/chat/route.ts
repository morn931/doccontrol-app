import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Project-wide Engineering Room. GET returns recent messages (oldest-first for
// rendering); POST inserts a message (service-role) and fans out @mention
// notifications. The browser gets live updates via Supabase Realtime — this
// route only seeds the history and posts.
export const dynamic = 'force-dynamic'
const ROOM = 'engineering'

async function me(): Promise<{ email: string; name: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await createServiceClient().from('users').select('email, full_name').eq('auth_user_id', user.id).single()
  return data?.email ? { email: data.email as string, name: (data.full_name as string) || (data.email as string) } : null
}

export async function GET() {
  try {
    const db = createServiceClient()
    const { data } = await db.from('chat_message')
      .select('id, author_email, author_name, body, image_url, created_at')
      .eq('room', ROOM).order('created_at', { ascending: false }).limit(60)
    return NextResponse.json({ messages: (data ?? []).reverse() })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}

// Notify anyone @mentioned by first name or email local part (best-effort).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyMentions(db: any, author: { email: string; name: string }, text: string, msgId: string) {
  try {
    const tokens = [...text.matchAll(/@([\w.-]+)/g)].map((m) => m[1].toLowerCase())
    if (!tokens.length) return
    const { data: users } = await db.from('users').select('email, full_name').eq('active', true).limit(1000)
    const targets = new Map<string, string>() // email -> name
    for (const u of users ?? []) {
      const email = String(u.email ?? '').toLowerCase()
      if (!email || email === author.email.toLowerCase()) continue
      const first = String(u.full_name ?? '').trim().split(/\s+/)[0].toLowerCase()
      const local = email.split('@')[0]
      if (tokens.includes(first) || tokens.includes(local)) targets.set(email, (u.full_name as string) || email)
    }
    if (!targets.size) return
    const snippet = text.length > 90 ? text.slice(0, 90) + '…' : text
    const rows = [...targets.keys()].map((email) => ({
      user_email: email, type: 'message', source_key: `message:${msgId}:${email}`,
      title: `${author.name} mentioned you in the Engineering Room`, body: snippet, href: '/home',
    }))
    await db.from('notification').upsert(rows, { onConflict: 'user_email,source_key', ignoreDuplicates: true })
  } catch { /* best-effort */ }
}

export async function POST(req: Request) {
  const who = await me()
  if (!who) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const text = String(b?.body ?? '').trim().slice(0, 4000)
  const imageUrl = b?.imageUrl ? String(b.imageUrl) : null
  if (!text && !imageUrl) return NextResponse.json({ error: 'Empty message.' }, { status: 400 })
  try {
    const db = createServiceClient()
    const { data: msg, error } = await db.from('chat_message')
      .insert({ room: ROOM, author_email: who.email, author_name: who.name, body: text || null, image_url: imageUrl })
      .select('id, author_email, author_name, body, image_url, created_at').single()
    if (error || !msg) {
      if (/relation .*chat_message.* does not exist/i.test(error?.message ?? '')) {
        return NextResponse.json({ error: 'Chat isn’t switched on yet (migration 045 pending).' }, { status: 503 })
      }
      return NextResponse.json({ error: error?.message ?? 'Could not send.' }, { status: 500 })
    }
    if (text) await notifyMentions(db, who, text, msg.id as string)
    return NextResponse.json({ message: msg })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
