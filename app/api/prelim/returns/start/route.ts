import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createLibraryUploadSession } from '@/lib/services/graph'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { prelimAuth, isErr, sessionFolder } from '@/lib/prelim'

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()

// Step 1 of a return: match the dropped file to a drawing in an open session, then hand
// back a pre-authorised SharePoint upload URL so the browser PUTs the bytes straight OVER
// the drawing's working copy (same path, replace) — the session folder only ever holds the
// latest file (Morné, 7 Sep: the marked-up copy lives on in the email). No Vercel body cap.
//
// Match order: the caller's explicit docId (the picker) → the document number in the
// filename → the exact filename the drawing was pulled or sent as. Anything else, or more
// than one hit, comes back 409 with the candidates so a person chooses. Never guessed.
//
// Body: { fileName, docId? }
export async function POST(req: Request) {
  const auth = await prelimAuth('view'); if (isErr(auth)) return auth
  const body = await req.json().catch(() => ({}))
  const fileName = String(body?.fileName ?? '').trim()
  const docId = String(body?.docId ?? '').trim()
  if (!fileName || /[\\/]|\.\./.test(fileName)) return NextResponse.json({ error: 'Choose a file.' }, { status: 400 })
  if (!/\.pdf$/i.test(fileName)) return NextResponse.json({ error: `${fileName}: only a PDF can come back as the drawing to review — drop the PDF (the DWG stays in COLAB).` }, { status: 415 })

  const db = createServiceClient()
  const { data: docs } = await db.from('prelim_document')
    .select('id, document_number, revision, title, source_file_name, working_file_name, working_file_url, routing, routing_at, returned_at, prelim_session!inner(id, title, status)')
    .eq('prelim_session.status', 'open').limit(2000)
  const all = (docs ?? []) as any[]
  const compact = (d: any) => ({ id: d.id, document_number: d.document_number, revision: d.revision, title: d.title, session: d.prelim_session.title, routing: d.routing })

  let hit: any | null = null
  if (docId) {
    hit = all.find(d => d.id === docId) ?? null
    if (!hit) return NextResponse.json({ error: 'That drawing is not in an open session.' }, { status: 404 })
  } else {
    const parsed = parseDocumentFileName(fileName)
    const no = parsed.normalizedDocumentNumber ? norm(parsed.normalizedDocumentNumber) : ''
    let hits = no && /^[A-Z0-9]{4,}-?/.test(no) ? all.filter(d => d.document_number && norm(d.document_number) === no) : []
    if (!hits.length) hits = all.filter(d => [d.working_file_name, d.source_file_name].some(n => n && n.toLowerCase() === fileName.toLowerCase()))
    if (hits.length !== 1) {
      return NextResponse.json({
        needPick: true,
        reason: hits.length ? `"${fileName}" matches ${hits.length} drawings — choose which one it is.` : `Could not tell which drawing "${fileName}" is — no document number in the name matches an open session. Choose it from the list.`,
        candidates: hits.map(compact), all: all.map(compact),
      }, { status: 409 })
    }
    hit = hits[0]
  }

  try {
    const folder = sessionFolder(hit.prelim_session.title, hit.prelim_session.id)
    const { uploadUrl } = await createLibraryUploadSession(`${folder}/${hit.working_file_name}`, undefined, undefined, 'replace')
    return NextResponse.json({ uploadUrl, doc: compact(hit), wasSent: hit.routing === 'drawing_office' || hit.routing === 'document_control' || hit.routing === 'lead' })
  } catch (e: any) { return NextResponse.json({ error: `SharePoint upload session failed: ${e?.message ?? e}` }, { status: 502 }) }
}
