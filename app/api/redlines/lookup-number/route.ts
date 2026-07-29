import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Drawing-number typeahead against the MDDR register (96k rows): the redline
// wizard only accepts numbers that exist in the system — no ghost redlines.
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (q.length < 3) return NextResponse.json({ results: [], exact: false })

  const db = createServiceClient()
  const { data } = await db.from('mddr_entries')
    .select('normalized_document_number, document_number, document_title, discipline, revision, package_code')
    .ilike('normalized_document_number', `${q}%`)
    .order('normalized_document_number', { ascending: true })
    .limit(40)

  // Dedupe by number (the register can carry a doc more than once).
  const seen = new Set<string>()
  const results: any[] = []
  for (const r of data ?? []) {
    const n = (r.normalized_document_number ?? '').toUpperCase()
    if (!n || seen.has(n)) continue
    seen.add(n)
    results.push({
      number: r.document_number ?? r.normalized_document_number,
      normalized: n,
      title: r.document_title ?? null,
      discipline: r.discipline ?? null,
      revision: r.revision ?? null,
      package: r.package_code ?? null,
    })
    if (results.length >= 12) break
  }
  return NextResponse.json({ results, exact: seen.has(q) })
}
