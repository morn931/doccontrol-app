import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseDocumentFileName, compareRevisions } from '@/lib/utils/document-number-parser'
import { normalizeDocNumber } from '@/lib/mddr/mapping'

export const runtime = 'nodejs'

// All known file versions for a document number (latest revision first), each with
// its own SharePoint URL — so any revision can be opened. Sourced from the live
// document_versions (reviewed docs carry every revision here).
export async function GET(req: NextRequest) {
  const db: any = createServiceClient()
  const docnum = (new URL(req.url).searchParams.get('docnum') || '').trim()
  if (!docnum) return NextResponse.json({ rows: [] })

  const { data, error } = await db.from('document_versions')
    .select('file_name, revision, central_file_url, reviewed_file_url, returned_file_url, status, uploaded_at, returned_at')
    .ilike('file_name', `%${docnum}%`)
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? [])
    .filter((v: any) => normalizeDocNumber(parseDocumentFileName(v.file_name ?? '').normalizedDocumentNumber) === docnum)
    .map((v: any) => ({
      revision: v.revision ?? parseDocumentFileName(v.file_name ?? '').revision,
      url: v.central_file_url || v.reviewed_file_url || v.returned_file_url || null,
      status: v.status,
      date: v.returned_at || v.uploaded_at,
      file_name: v.file_name,
    }))
    .sort((a: any, b: any) => compareRevisions(b.revision, a.revision))   // latest first

  return NextResponse.json({ rows })
}
