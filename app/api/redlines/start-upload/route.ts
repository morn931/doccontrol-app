import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createLibraryUploadSession, REDLINE_FOLDER } from '@/lib/services/graph'

// Step 1 of adding a redline file: ensure the caller has a draft submission and
// hand back a pre-authorised SharePoint upload URL. The browser PUTs the chunks
// directly (dodges the request-body cap for big scans), then registers the
// document's metadata via POST /api/redlines/docs.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { fileName, submissionId } = await req.json()
  if (!fileName || /[\\/]|\.\./.test(String(fileName))) {
    return NextResponse.json({ error: 'Valid file name required' }, { status: 400 })
  }

  const db = createServiceClient()
  let sid = submissionId as string | undefined
  if (sid) {
    const { data: s } = await db.from('redline_submission')
      .select('id, created_by_email, status').eq('id', sid).maybeSingle()
    if (!s || s.created_by_email !== user.email || s.status !== 'draft') sid = undefined
  }
  if (!sid) {
    const { data: existing } = await db.from('redline_submission')
      .select('id').eq('created_by_email', user.email).eq('status', 'draft')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    sid = existing?.id
  }
  if (!sid) {
    const { data: created, error } = await db.from('redline_submission')
      .insert({ created_by_email: user.email, submitter_name: user.email })
      .select('id').single()
    if (error || !created) return NextResponse.json({ error: error?.message ?? 'Could not create submission' }, { status: 500 })
    sid = created.id
  }

  try {
    const { uploadUrl } = await createLibraryUploadSession(`${REDLINE_FOLDER}/${sid}/${fileName}`)
    return NextResponse.json({ uploadUrl, submissionId: sid })
  } catch (e: any) {
    return NextResponse.json({ error: `SharePoint upload session failed: ${e?.message ?? e}` }, { status: 502 })
  }
}
