import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Streams a registered Aconex document's file to the logged-in CoreDocs user by
// proxying CoreCost's secret-gated /api/aconex/document (CoreDocs holds no Aconex key).
// Session-protected by middleware, so only authenticated users reach it.
export async function GET(req: NextRequest) {
  const doc = req.nextUrl.searchParams.get('doc')
  if (!doc) return NextResponse.json({ error: 'missing doc' }, { status: 400 })
  const markedup = req.nextUrl.searchParams.get('markedup') === '1' ? '1' : '0'

  const base = (process.env.CORECOST_URL || 'https://costflow-app.vercel.app').replace(/\/+$/, '')
  const secret = process.env.ACONEX_SEARCH_SECRET
  if (!secret) return NextResponse.json({ error: 'viewer not configured' }, { status: 503 })

  const upstream = await fetch(
    `${base}/api/aconex/document?id=${encodeURIComponent(doc)}&markedup=${markedup}`,
    { headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store' }
  )
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `document unavailable (HTTP ${upstream.status})` },
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
