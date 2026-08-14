/**
 * GET /api/debug/titleblock?url=<sharepoint pdf url>  — CRON_SECRET-gated.
 * Runs the title-block detector against a real PDF IN the serverless runtime, so we can verify
 * pdf.js works on Vercel (the sign-off placement depends on it). Returns the detected columns
 * and a page-1 word count. Diagnostic only — no writes.
 */
import { NextResponse } from 'next/server'
import { getFileBytesByUrl } from '@/lib/services/graph'
import { findTitleBlockColumns } from '@/lib/signoff-pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const url = new URL(req.url).searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Pass ?url=<sharepoint pdf url>' }, { status: 400 })

  try {
    const bytes = await getFileBytesByUrl(url)
    const size = bytes instanceof Uint8Array ? bytes.byteLength : (bytes as ArrayBuffer).byteLength
    const cols = await findTitleBlockColumns(bytes).catch((e: any) => ({ __error: String(e?.message ?? e) }))
    return NextResponse.json({ ok: true, size, columns: cols })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 })
  }
}
