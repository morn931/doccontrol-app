'use server'

// Live search of the whole Aconex register, proxied through CoreCost (which holds the
// Aconex credentials). Keeps the Aconex private key with a single custodian.

export type AconexSearchRow = {
  docId: string
  docno: string
  title: string
  docType: string
  discipline: string
  package: string
  revision: string
  authorOrg: string
  docStatus: string
  reviewStatus: string
  dateModified: string
  court: string
  courtLabel: string
  filename: string
  hasFile: boolean
  webUrl: string
}

export type SearchResult =
  | { ok: true; total: number; page: number; pageSize: number; results: AconexSearchRow[] }
  | { ok: false; error: string }

export async function searchAconex(q: string, ppeOnly: boolean): Promise<SearchResult> {
  const query = (q ?? '').trim()
  if (query.length < 2) return { ok: false, error: 'Type at least 2 characters.' }

  const base = (process.env.CORECOST_URL || 'https://costflow-app.vercel.app').replace(/\/+$/, '')
  const secret = process.env.ACONEX_SEARCH_SECRET
  if (!secret) {
    return { ok: false, error: 'Live search is not configured yet (ACONEX_SEARCH_SECRET missing).' }
  }

  try {
    const url = `${base}/api/aconex/search?q=${encodeURIComponent(query)}&ppe_only=${ppeOnly ? '1' : '0'}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
    const data = await res.json()
    if (!res.ok || !data.ok) {
      return { ok: false, error: data?.error ? `Aconex: ${data.error}` : `Search failed (HTTP ${res.status}).` }
    }
    return data as SearchResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Search request failed.' }
  }
}
