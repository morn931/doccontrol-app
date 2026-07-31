import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createLibraryUploadSession, REDLINE_FOLDER } from '@/lib/services/graph'

// Chunked-upload session for an As-Built file, stored beside its redline:
// "Site Redlines/<submission>/asbuilt/<fileName>". Only the accepting engineer.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { submissionId, fileName } = await req.json()
  if (!submissionId || !fileName || /[\\/]|\.\./.test(String(fileName))) {
    return NextResponse.json({ error: 'submissionId and a valid file name are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: s } = await db.from('redline_submission')
    .select('id, review_state, asbuilt_engineer_email').eq('id', submissionId).maybeSingle()
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (s.asbuilt_engineer_email !== user.email) return NextResponse.json({ error: 'This redline is not awaiting your As-Built' }, { status: 403 })
  if (s.review_state !== 'awaiting_asbuilt') return NextResponse.json({ error: `Redline is ${s.review_state}, not awaiting an As-Built` }, { status: 409 })

  try {
    const { uploadUrl } = await createLibraryUploadSession(`${REDLINE_FOLDER}/${submissionId}/asbuilt/${fileName}`)
    return NextResponse.json({ uploadUrl })
  } catch (e: any) {
    return NextResponse.json({ error: `SharePoint upload session failed: ${e?.message ?? e}` }, { status: 502 })
  }
}
