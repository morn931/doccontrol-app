import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getFileBytesByUrl, getDriveItemContentBytes, resolveDriveItemByUrl, uploadBytesToLibraryFolder } from '@/lib/services/graph'
import { prelimAuth, isErr, matchCddl, sessionFolder } from '@/lib/prelim'

export const maxDuration = 300

// Pull chosen files from the source folder into the session: a working PDF copy of each
// goes to Internal Reviews / Prelim / <session> (the isolated library the review engine
// already serves from), and a prelim_document row is created with its CDDL match. The
// source file is never touched. Pulling a file twice is a no-op (unique on source URL).
//
// Body: { files: [{ name, webUrl }] }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await prelimAuth('manage'); if (isErr(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const files: { name: string; webUrl: string }[] = Array.isArray(body?.files) ? body.files : []
  if (!files.length) return NextResponse.json({ error: 'Choose at least one file to pull.' }, { status: 400 })

  const db = createServiceClient()
  const { data: session } = await db.from('prelim_session').select('id, title, status').eq('id', id).single()
  if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  if ((session as any).status !== 'open') return NextResponse.json({ error: 'This session is closed.' }, { status: 409 })

  const folder = sessionFolder((session as any).title, id)
  const results: { name: string; ok: boolean; docId?: string; documentNumber?: string | null; matched?: boolean; skipped?: string; error?: string }[] = []

  for (const f of files.slice(0, 200)) {
    const name = String(f?.name ?? '').trim(), webUrl = String(f?.webUrl ?? '').trim()
    if (!name || !webUrl) { results.push({ name, ok: false, error: 'missing name or url' }); continue }
    try {
      const { data: existing } = await db.from('prelim_document').select('id').eq('session_id', id).eq('source_file_url', webUrl).maybeSingle()
      if (existing) { results.push({ name, ok: true, docId: (existing as any).id, skipped: 'already in the session' }); continue }

      // Working copy: PDFs as they are; anything else rendered to PDF by Graph so the
      // room can mark it up. (Drawings in COLAB are PDFs; this covers the odd DOCX.)
      const isPdf = /\.pdf$/i.test(name)
      let bytes: ArrayBuffer
      if (isPdf) bytes = await getFileBytesByUrl(webUrl)
      else {
        const item = await resolveDriveItemByUrl(webUrl)
        if (!item?.driveId) throw new Error('could not resolve the source file')
        bytes = await getDriveItemContentBytes(item.driveId, item.id, 'pdf')
      }
      const workingName = isPdf ? name : name.replace(/\.[^.]+$/, '') + '.pdf'
      const up = await uploadBytesToLibraryFolder(`${folder}/${workingName}`, bytes, 'application/pdf')

      const { parsed, cddl } = await matchCddl(name)
      const { data: row, error } = await db.from('prelim_document').insert({
        session_id:        id,
        cddl_doc_id:       cddl?.id ?? null,
        document_number:   cddl?.docno ?? (parsed.revision ? parsed.normalizedDocumentNumber : null),
        revision:          parsed.revision ?? cddl?.revision ?? null,
        title:             cddl?.title ?? name.replace(/\.[^.]+$/, ''),
        discipline:        cddl?.discipline ?? null,
        document_type:     cddl?.doc_type ?? null,
        source_file_name:  name,
        source_file_url:   webUrl,
        working_file_name: workingName,
        working_file_url:  up.webUrl,
        pulled_by_email:   auth.email,
      }).select('id').single()
      if (error || !row) throw new Error(error?.message ?? 'insert failed')
      results.push({ name, ok: true, docId: (row as any).id, documentNumber: cddl?.docno ?? null, matched: !!cddl })
    } catch (e: any) {
      results.push({ name, ok: false, error: e?.message ?? String(e) })
    }
  }

  await db.from('audit_events').insert({
    entity_type: 'prelim_session', entity_id: id, event_type: 'prelim_documents_pulled',
    actor_user_id: auth.userId, actor_email: auth.email,
    event_data: { pulled: results.filter(r => r.ok && !r.skipped).length, failed: results.filter(r => !r.ok).length },
  }).then(() => null, () => null)

  return NextResponse.json({ results })
}
