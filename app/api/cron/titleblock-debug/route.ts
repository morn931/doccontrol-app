/**
 * GET /api/debug/titleblock?url=<sharepoint pdf url>
 * Diagnostic (no writes). Runs pdf.js text extraction IN the serverless runtime against a real
 * PDF and returns the RAW error / token counts, so we can see why title-block detection fails on
 * Vercel. Gated by CRON_SECRET or the Supabase service-role key (bearer).
 */
import { NextResponse } from 'next/server'
import { getFileBytesByUrl } from '@/lib/services/graph'
import { findTitleBlockColumns } from '@/lib/signoff-pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const ok = (!!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
    || (!!process.env.SUPABASE_SERVICE_ROLE_KEY && auth === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`)
  if (!ok) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const url = new URL(req.url).searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Pass ?url=<sharepoint pdf url>' }, { status: 400 })

  const out: any = { url } // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const bytes = await getFileBytesByUrl(url)
    out.size = bytes instanceof Uint8Array ? bytes.byteLength : (bytes as ArrayBuffer).byteLength

    // Raw pdf.js extraction attempt — capture the exact failure the detector swallows.
    try {
      const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs') // eslint-disable-line @typescript-eslint/no-explicit-any
      out.pdfjsImport = 'ok'
      const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      const doc = await pdfjs.getDocument({ data: new Uint8Array(src), useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise
      out.numPages = doc.numPages
      const page = await doc.getPage(1)
      const tc = await page.getTextContent()
      const items = (tc.items as any[]).filter(i => typeof i.str === 'string') // eslint-disable-line @typescript-eslint/no-explicit-any
      out.tokenCount = items.length
      out.approvTokens = items.filter(i => i.str.toUpperCase().includes('APPROV')).map(i => i.str).slice(0, 6)
      await doc.destroy()
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      out.pdfjsError = String(e?.message ?? e)
      out.pdfjsStack = String(e?.stack ?? '').split('\n').slice(0, 6)
    }

    out.columns = await findTitleBlockColumns(bytes).catch((e: any) => ({ __error: String(e?.message ?? e) })) // eslint-disable-line @typescript-eslint/no-explicit-any
    return NextResponse.json(out)
  } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    out.fatal = String(e?.message ?? e)
    return NextResponse.json(out, { status: 500 })
  }
}
