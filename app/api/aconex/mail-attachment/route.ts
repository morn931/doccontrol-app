import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Streams an Aconex MAIL attachment (RFI Tracker popup) to the logged-in
// CoreDocs user by proxying CoreCost's secret-gated /api/aconex/attachment
// (CoreDocs holds no Aconex key — same custodian pattern as /api/aconex/document).
// Session-protected by middleware, so only authenticated users reach it.
export async function GET(req: NextRequest) {
  const mailId = req.nextUrl.searchParams.get('mailId')
  const attachmentId = req.nextUrl.searchParams.get('attachmentId')
  const filename = req.nextUrl.searchParams.get('filename') ?? 'attachment'
  if (!mailId || !attachmentId) {
    return NextResponse.json({ error: 'mailId and attachmentId are required' }, { status: 400 })
  }

  const base = (process.env.CORECOST_URL || 'https://costflow-app.vercel.app').replace(/\/+$/, '')
  const secret = process.env.ACONEX_SEARCH_SECRET
  if (!secret) return NextResponse.json({ error: 'attachments not configured' }, { status: 503 })

  const upstream = await fetch(
    `${base}/api/aconex/attachment?mailId=${encodeURIComponent(mailId)}&attachmentId=${encodeURIComponent(attachmentId)}&filename=${encodeURIComponent(filename)}`,
    { headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store' }
  )
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `attachment unavailable (HTTP ${upstream.status})` },
      { status: upstream.status === 404 ? 404 : 502 }
    )
  }
  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream')
  const disp = upstream.headers.get('content-disposition')
  if (disp) headers.set('Content-Disposition', disp)
  const len = upstream.headers.get('content-length')
  if (len) headers.set('Content-Length', len)
  return new NextResponse(upstream.body, { status: 200, headers })
}
