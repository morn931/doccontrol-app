/**
 * POST /api/documents/signoff-intake/start-upload
 *
 * Step 1 of the DC's Sign-off Intake — validate the file the DC downloaded from Aconex against
 * the CDDL document she picked, then hand back a direct SharePoint upload URL (the browser PUTs
 * chunks straight to SharePoint, dodging Vercel's ~4.5 MB body cap). Finalised via
 * POST /api/documents/signoff-intake. Gated by ACTION_APPROVE_SIGNOFF_ONLY.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'
import { createLibraryUploadSession } from '@/lib/services/graph'

const norm = (s: string) => (s ?? '').replace(/\s+/g, '').toUpperCase()

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('role').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  if (!can(perms, FK.ACTION_APPROVE_SIGNOFF_ONLY, (profile?.role ?? 'reviewer') as any))
    return NextResponse.json({ error: 'Not authorised to send a document straight to sign-off.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const docId = String(body?.docId ?? '')
  const fileName = String(body?.fileName ?? '')
  const confirmNumber = body?.confirmNumber === true || body?.confirmNumber === '1'
  if (!docId) return NextResponse.json({ error: 'Pick a document from the CDDL first.' }, { status: 400 })
  if (!fileName || /[\\/]|\.\./.test(fileName)) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })

  const db = createServiceClient()
  const { data: doc } = await db.from('cddl_doc').select('docno, revision').eq('id', docId).single()
  if (!doc) return NextResponse.json({ error: 'That CDDL document was not found.' }, { status: 404 })

  // Confirm the file's number matches the CDDL document (unless the DC has confirmed a mismatch).
  const parsed = parseDocumentFileName(fileName)
  if (!confirmNumber && norm(parsed.normalizedDocumentNumber) !== norm((doc as any).docno)) {
    return NextResponse.json({
      error: `The file's number (${parsed.displayDocumentNumber || fileName}) does not match the selected document (${(doc as any).docno}). Upload it anyway?`,
      needsConfirm: 'number',
    }, { status: 409 })
  }
  const revision = parsed.revision ?? (doc as any).revision ?? '0'

  try {
    const { uploadUrl } = await createLibraryUploadSession(fileName)
    return NextResponse.json({ uploadUrl, revision })
  } catch (e) {
    return NextResponse.json({ error: `SharePoint upload session failed: ${e instanceof Error ? e.message : e}` }, { status: 502 })
  }
}
