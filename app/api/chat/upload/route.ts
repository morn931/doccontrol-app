import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

// Upload a chat image to the public 'chat-uploads' Supabase Storage bucket and
// return its URL. The client then posts a message carrying that image_url.
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file || file.size === 0) return NextResponse.json({ error: 'Choose an image.' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Images only.' }, { status: 400 })
  if (file.size > 26_214_400) return NextResponse.json({ error: 'Image is too large (max 25 MB).' }, { status: 400 })

  const db = createServiceClient()
  const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `engineering/${randomUUID()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  const up = await db.storage.from('chat-uploads').upload(path, buf, { contentType: file.type, upsert: false })
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 502 })
  const url = db.storage.from('chat-uploads').getPublicUrl(path).data.publicUrl
  return NextResponse.json({ url })
}
