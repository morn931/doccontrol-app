import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { embedOne } from '@/lib/services/embeddings'

export const runtime = 'nodejs'
export const maxDuration = 30

// Natural-language / semantic search over MDDR documents (AI-summary embeddings).
export async function POST(req: NextRequest) {
  const db: any = createServiceClient()
  let body: any = {}
  try { body = await req.json() } catch {}
  const query = (body?.query ?? '').trim()
  if (!query) return NextResponse.json({ rows: [] })

  try {
    const vec = await embedOne(query)
    const { data, error } = await db.rpc('match_mddr', {
      query_embedding: `[${vec.join(',')}]`,
      match_count: Math.min(body?.limit ?? 50, 200),
      p_package: body?.package && body.package !== 'ALL' ? body.package : null,
      p_source:  body?.source  && body.source  !== 'ALL' ? body.source  : null,
      p_awarded: body?.awarded === 'false' ? false : body?.awarded === 'all' ? null : true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rows: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
