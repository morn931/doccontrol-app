// Pull files into a prelim session — the one implementation behind the Pull button, the
// recursive folder pull, and the on-load sync (lib/prelim/sync.ts). A working PDF copy of
// each file goes to Internal Reviews / Prelim / <session> and a prelim_document row is
// created with its CDDL match. The source file is never touched; pulling twice is a no-op.
import { createServiceClient } from '@/lib/supabase/server'
import { getFileBytesByUrl, getDriveItemContentBytes, resolveDriveItemByUrl, uploadBytesToLibraryFolder, listLibraryFolder, resolveLibraryName } from '@/lib/services/graph'
import { matchCddl, sessionFolder } from '@/lib/prelim'

export type PullSession = { id: string; title: string; status: string; source_site_url: string; source_library: string; source_folder: string }
export type PullFile = { name: string; webUrl: string }
export type PullResult = { name: string; ok: boolean; docId?: string; documentNumber?: string | null; matched?: boolean; skipped?: string; error?: string }

/** Every file under a folder and its subfolders (Vossie's tree is substation → discipline). */
export async function listFolderTree(session: PullSession, folder: string, maxDepth = 6): Promise<PullFile[]> {
  const library = await resolveLibraryName(session.source_site_url, session.source_library)
  const files: PullFile[] = []
  const walk = async (rel: string, depth: number) => {
    const items = await listLibraryFolder(session.source_site_url, library, rel)
    for (const it of items) {
      if (it.isFolder) { if (depth < maxDepth) await walk(rel ? `${rel}/${it.name}` : it.name, depth + 1) }
      else files.push({ name: it.name, webUrl: it.webUrl })
    }
  }
  await walk(folder.replace(/\.\./g, '').replace(/^\/+|\/+$/g, ''), 0)
  return files
}

export async function pullFilesIntoSession(session: PullSession, files: PullFile[], byEmail: string): Promise<PullResult[]> {
  const db = createServiceClient()
  const folder = sessionFolder(session.title, session.id)
  const results: PullResult[] = []
  for (const f of files.slice(0, 500)) {
    const name = String(f?.name ?? '').trim(), webUrl = String(f?.webUrl ?? '').trim()
    if (!name || !webUrl) { results.push({ name, ok: false, error: 'missing name or url' }); continue }
    try {
      const { data: existing } = await db.from('prelim_document').select('id').eq('session_id', session.id).eq('source_file_url', webUrl).maybeSingle()
      if (existing) { results.push({ name, ok: true, docId: (existing as any).id, skipped: 'already in the session' }); continue }
      // Working copy: PDFs as they are; anything else rendered to PDF by Graph so the room can mark it up.
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
        session_id:        session.id,
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
        pulled_by_email:   byEmail,
      }).select('id').single()
      if (error || !row) throw new Error(error?.message ?? 'insert failed')
      results.push({ name, ok: true, docId: (row as any).id, documentNumber: cddl?.docno ?? null, matched: !!cddl })
    } catch (e: any) {
      results.push({ name, ok: false, error: e?.message ?? String(e) })
    }
  }
  return results
}
