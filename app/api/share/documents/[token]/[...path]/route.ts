import { NextRequest, NextResponse } from 'next/server'
import { getShareLink, touchShareLink } from '@/lib/share-tokens'
import { GET as mddrGET } from '@/app/api/mddr/route'
import { GET as metaGET } from '@/app/api/mddr/meta/route'
import { GET as revsGET } from '@/app/api/mddr/revisions/route'
import { POST as semanticPOST } from '@/app/api/mddr/semantic/route'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveOpenUrl } from '@/lib/services/sp-resolve'
import { getFileBytesByUrl } from '@/lib/services/graph'

export const runtime = 'nodejs'
export const maxDuration = 60

// Token-gated public entry to the document search. Validates the share_link, then:
//  · mddr / meta / revisions  → the existing service-role handlers (read-only)
//  · open                     → streams the file's bytes via Graph (app creds), so
//                               the viewer never needs SharePoint access.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; path?: string[] }> }) {
  const { token, path } = await params
  const link = await getShareLink(token)
  if (!link || link.kind !== 'documents') return new NextResponse('Not found', { status: 404 })

  const sub = (path ?? []).join('/')
  const url = new URL(req.url)
  const proxy = (internalPath: string) => new NextRequest(new URL(internalPath + url.search, url.origin), { headers: req.headers })

  if (sub === 'mddr') return mddrGET(proxy('/api/mddr'))
  if (sub === 'meta') return metaGET(proxy('/api/mddr/meta'))
  if (sub === 'revisions') return revsGET(proxy('/api/mddr/revisions'))

  if (sub === 'open') {
    const id = url.searchParams.get('id')
    if (!id) return new NextResponse('Missing id', { status: 400 })
    const db: any = createServiceClient()
    const { data: row } = await db.from('mddr_entries')
      .select('file_link, normalized_document_number, document_number')
      .eq('id', id).maybeSingle()
    if (!row?.file_link) return new NextResponse('No file for this document', { status: 404 })
    const live = (await resolveOpenUrl(row.file_link, row.normalized_document_number || row.document_number)) || row.file_link
    try {
      const bytes = await getFileBytesByUrl(live)
      const fname = decodeURIComponent((live.split('?')[0].split('/').pop() || 'document.pdf'))
      const ext = fname.split('.').pop()?.toLowerCase()
      const ct = ext === 'pdf' ? 'application/pdf'
        : ext === 'png' ? 'image/png'
        : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
        : (ext === 'xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : (ext === 'docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/octet-stream'
      touchShareLink(token).catch(() => {})
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          'Content-Type': ct,
          'Content-Disposition': `inline; filename="${fname.replace(/"/g, '')}"`,
          'Cache-Control': 'private, no-store',
        },
      })
    } catch (e: any) {
      return new NextResponse('Could not retrieve the file: ' + (e?.message ?? 'error'), { status: 502 })
    }
  }

  return new NextResponse('Not found', { status: 404 })
}

// Smart (semantic) search on the shared link — token-gated proxy to the AI endpoint.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string; path?: string[] }> }) {
  const { token, path } = await params
  const link = await getShareLink(token)
  if (!link || link.kind !== 'documents') return new NextResponse('Not found', { status: 404 })
  if ((path ?? []).join('/') === 'semantic') return semanticPOST(req)
  return new NextResponse('Not found', { status: 404 })
}
