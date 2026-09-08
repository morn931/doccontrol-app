import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { prelimAuth, isErr } from '@/lib/prelim'
import { listFolderTree, pullFilesIntoSession, type PullFile, type PullSession } from '@/lib/prelim/pull'

export const maxDuration = 300

// Pull chosen files from the source folder into the session: a working PDF copy of each
// goes to Internal Reviews / Prelim / <session> (the isolated library the review engine
// already serves from), and a prelim_document row is created with its CDDL match. The
// source file is never touched. Pulling a file twice is a no-op (unique on source URL).
// The work itself lives in lib/prelim/pull.ts, shared with the on-load sync.
//
// Body: { files: [{ name, webUrl }] }  — the ticked files
//    or { folder, recursive: true }     — every file under that folder and its subfolders
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await prelimAuth('manage'); if (isErr(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  let files: PullFile[] = Array.isArray(body?.files) ? body.files : []

  const db = createServiceClient()
  const { data: session } = await db.from('prelim_session').select('id, title, status, source_site_url, source_library, source_folder').eq('id', id).single()
  if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  const s = session as PullSession
  if (s.status !== 'open') return NextResponse.json({ error: 'This session is closed.' }, { status: 409 })

  if (!files.length && body?.recursive && typeof body?.folder === 'string') {
    try { files = await listFolderTree(s, String(body.folder)) }
    catch (e: any) { return NextResponse.json({ error: `Could not list the folder: ${e?.message ?? e}` }, { status: 502 }) }
    if (!files.length) return NextResponse.json({ error: 'That folder and its subfolders hold no files yet.' }, { status: 404 })
  }
  if (!files.length) return NextResponse.json({ error: 'Choose at least one file to pull.' }, { status: 400 })

  const results = await pullFilesIntoSession(s, files, auth.email)
  await db.from('audit_events').insert({
    entity_type: 'prelim_session', entity_id: id, event_type: 'prelim_documents_pulled',
    actor_user_id: auth.userId, actor_email: auth.email,
    event_data: { pulled: results.filter(r => r.ok && !r.skipped).length, failed: results.filter(r => !r.ok).length },
  }).then(() => null, () => null)
  return NextResponse.json({ results })
}
