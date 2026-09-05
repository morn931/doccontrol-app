import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveDriveItemByUrl, getDriveItemContentBytes, graphFetch } from '@/lib/services/graph'
import { checkDocumentQuality, openCount } from '@/lib/prelim/quality-check'
import { prelimAuth, isErr } from '@/lib/prelim'

export const maxDuration = 120

// Run the quality check on ONE drawing, reading the SOURCE file in COLAB as it is right now.
// The session page calls this per document with a progress count, so a session of thirty
// never sits behind one long request. Every run is kept (prelim_quality_run) and the latest
// is written onto the document for the table.
export async function POST(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const { docId } = await params
  const db = createServiceClient()
  const { data: doc } = await db.from('prelim_document')
    .select('id, document_number, revision, title, discipline, document_type, source_file_name, source_file_url, cddl_doc_id, prelim_session!inner(status)')
    .eq('id', docId).maybeSingle()
  const d = doc as any
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // what the register says — the CDDL row where matched, else what the session holds
  let expected: any = { document_number: d.document_number, title: d.title, revision: d.revision, discipline: d.discipline, document_type: d.document_type }
  if (d.cddl_doc_id) {
    const { data: c } = await db.from('cddl_doc').select('docno, title, revision, discipline, doc_type').eq('id', d.cddl_doc_id).maybeSingle()
    if (c) expected = { document_number: (c as any).docno, title: (c as any).title ?? d.title, revision: (c as any).revision ?? d.revision, discipline: (c as any).discipline ?? d.discipline, document_type: (c as any).doc_type ?? d.document_type }
  }

  const fail = async (error: string, status = 502) => {
    await db.from('prelim_quality_run').insert({ prelim_document_id: docId, checked_by_email: auth.email, source_file_url: d.source_file_url, open_count: 0, report: {}, error })
    return NextResponse.json({ error }, { status })
  }

  // the source, live
  let bytes: ArrayBuffer, modified: string | null = null, name = d.source_file_name, converted = false
  try {
    const item = await resolveDriveItemByUrl(d.source_file_url)
    if (!item?.driveId) return await fail('The source file could not be found in COLAB — was it moved or renamed?', 404)
    name = item.name
    const meta = await graphFetch(`/drives/${item.driveId}/items/${item.id}?$select=lastModifiedDateTime`)
    if (meta.ok) modified = (await meta.json()).lastModifiedDateTime ?? null
    const isPdf = /\.pdf$/i.test(item.name)
    converted = !isPdf
    bytes = await getDriveItemContentBytes(item.driveId, item.id, isPdf ? undefined : 'pdf')
  } catch (e: any) { return await fail(`Could not read the source file: ${e?.message ?? e}`) }

  const out = await checkDocumentQuality({ pdfBytes: Buffer.from(bytes), fileName: name, expected, converted })
  if (!out.ok) return await fail(`Quality check failed: ${out.error}`)
  const open = openCount(out.report)
  const now = new Date().toISOString()
  await db.from('prelim_quality_run').insert({ prelim_document_id: docId, checked_by_email: auth.email, source_file_url: d.source_file_url, source_modified_at: modified, open_count: open, report: out.report })
  await db.from('prelim_document').update({ quality_latest: out.report, quality_open: open, quality_checked_at: now, quality_source_modified_at: modified }).eq('id', docId)
  return NextResponse.json({ ok: true, open, report: out.report, checkedAt: now, sourceModifiedAt: modified })
}
