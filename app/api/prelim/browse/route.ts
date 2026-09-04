import { NextResponse } from 'next/server'
import { listLibraryFolder, resolveLibraryName } from '@/lib/services/graph'
import { prelimAuth, isErr, PRELIM_SOURCE_SITE_URL, PRELIM_SOURCE_LIBRARY } from '@/lib/prelim'

// List a folder in the source library (the K138 COLAB library by default) so the
// session opener picks drawings without downloading anything. Same primitive Rev 0
// Intake uses; any site/library can be passed, so the tool is not tied to COLAB.
export async function GET(req: Request) {
  const auth = await prelimAuth('manage'); if (isErr(auth)) return auth
  const url = new URL(req.url)
  const site = url.searchParams.get('site') || PRELIM_SOURCE_SITE_URL
  const libraryWanted = url.searchParams.get('library') || PRELIM_SOURCE_LIBRARY
  const path = (url.searchParams.get('path') ?? '').replace(/\.\./g, '').replace(/^\/+|\/+$/g, '')
  try {
    const library = await resolveLibraryName(site, libraryWanted)
    const items = await listLibraryFolder(site, library, path)
    items.sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1))
    return NextResponse.json({ site, library, path, items })
  } catch (e: any) {
    return NextResponse.json({ error: `Could not list "${libraryWanted}/${path}": ${e?.message ?? e}` }, { status: 502 })
  }
}
