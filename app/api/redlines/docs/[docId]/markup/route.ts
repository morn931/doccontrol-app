import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Draft-redline markup persistence — same GET/POST contract as the review
// markup endpoints, so the shared PdfMarkup component drives both.
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { docId } = await params
  const db = createServiceClient()
  const { data: doc } = await db.from('redline_document')
    .select('markup_layer, markup_comments').eq('id', docId).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ markup: { layer: doc.markup_layer, comments: doc.markup_comments } })
}

export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { docId } = await params
  const { layer, comments } = await req.json()
  const db = createServiceClient()
  const { error } = await db.from('redline_document')
    .update({ markup_layer: layer ?? null, markup_comments: comments ?? null })
    .eq('id', docId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
