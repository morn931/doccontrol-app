import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, email')
    .eq('auth_user_id', user.id).single()
  if (!['admin','document_controller','developer'].includes(profile?.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { doc_name, discipline, document_type, topic } = body

  const db = createServiceClient()
  const { data, error } = await db.from('document_versions')
    .update({
      doc_name:          doc_name,
      discipline:        discipline,
      document_type:     document_type,
      topic:             topic,
      ai_metadata_source: 'manually_confirmed',
      updated_at:        new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
