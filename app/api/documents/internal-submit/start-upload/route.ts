/**
 * POST /api/documents/internal-submit/start-upload
 *
 * Step 1 of the internal-review submission — validate the drawing against its allocated
 * request line, then hand back a pre-authorised SharePoint upload URL. The browser PUTs the
 * file chunks STRAIGHT to SharePoint (dodging Vercel's ~4.5 MB request-body cap that made big
 * PDFs fail with "Unexpected token 'R', 'Request En'…" = a 413 Request Entity Too Large), then
 * finalises via POST /api/documents/internal-submit with the resulting SharePoint URL.
 *
 * All the number / revision validation happens HERE, before any bytes move, so a wrong number
 * or an unconfirmed same-revision re-issue never leaves an orphan file in SharePoint.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { createLibraryUploadSession } from '@/lib/services/graph'

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('id, role').eq('auth_user_id', user.id).single()
  const role = (profile?.role ?? 'reviewer') as string
  const perms = await getPermissions(supabase)

  const body = await req.json().catch(() => null)
  const lineId = String(body?.lineId ?? '')
  const fileName = String(body?.fileName ?? '')
  const newRevision = body?.newRevision === true || body?.newRevision === '1'
  const confirmSameRevision = body?.confirmSameRevision === true || body?.confirmSameRevision === '1'
  // DC "Sign-off only" upload (Aconex-returned revision → straight to sign-off) is authorised
  // by ACTION_APPROVE_SIGNOFF_ONLY instead of the engineer's submit permission.
  const signoffOnly = body?.signoffOnly === true || body?.signoffOnly === '1'
  const authorised = can(perms, FK.ACTION_SUBMIT_INTERNAL_DRAWING, role)
    || (signoffOnly && can(perms, FK.ACTION_APPROVE_SIGNOFF_ONLY, role))
  if (!authorised)
    return NextResponse.json({ error: 'Not authorised to submit an internal drawing.' }, { status: 403 })
  if (!lineId) return NextResponse.json({ error: 'Missing request line.' }, { status: 400 })
  if (!fileName || /[\\/]|\.\./.test(fileName)) return NextResponse.json({ error: 'Choose a drawing file to upload.' }, { status: 400 })

  const svc = createServiceClient()

  // ─── Load the allocated request line ──────────────────────────────────────
  const { data: line } = await svc.from('document_number_request_line')
    .select('id, rdmc_document_number, revision, linked_document_id')
    .eq('id', lineId).single()
  if (!line) return NextResponse.json({ error: 'Request line not found.' }, { status: 404 })
  if (!line.rdmc_document_number)
    return NextResponse.json({ error: 'This line has no allocated number yet — Document Control must allocate it first.' }, { status: 400 })

  const existingDocId: string | null = line.linked_document_id ?? null
  if (existingDocId && !newRevision)
    return NextResponse.json({ error: 'A drawing has already been submitted for this line. Use "Submit new revision" to book a newer revision in.' }, { status: 409 })

  // ─── Confirm the file's number against the allocated number ──────────────
  const parsed = parseDocumentFileName(fileName)
  if (norm(parsed.normalizedDocumentNumber) !== norm(line.rdmc_document_number)) {
    return NextResponse.json({
      error: `The file's number (${parsed.displayDocumentNumber}) does not match the allocated number (${line.rdmc_document_number}). Rename the file to ${line.rdmc_document_number}_${line.revision ?? 'A'}.pdf and try again.`,
    }, { status: 422 })
  }
  const revision = parsed.revision ?? line.revision ?? 'A'

  // New-revision re-book at the SAME revision label (a real Aconex case) needs an explicit confirm.
  if (existingDocId && !confirmSameRevision) {
    const { data: existingVers } = await svc.from('document_versions').select('revision').eq('document_id', existingDocId)
    const have = new Set((existingVers ?? []).map((v: { revision?: string | null }) => String(v.revision ?? '').toUpperCase()))
    if (have.has(String(revision).toUpperCase()))
      return NextResponse.json({
        error: `Revision ${revision} is already in CoreDocs for ${line.rdmc_document_number}. Re-issue it at the same revision (a fresh review & sign-off cycle)?`,
        needsConfirm: 'sameRevision',
      }, { status: 409 })
  }

  // ─── All checks passed — hand back a direct SharePoint upload URL ─────────
  try {
    const { uploadUrl } = await createLibraryUploadSession(fileName)
    return NextResponse.json({ uploadUrl, revision })
  } catch (e) {
    return NextResponse.json({ error: `SharePoint upload session failed: ${e instanceof Error ? e.message : e}` }, { status: 502 })
  }
}
