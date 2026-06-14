/**
 * Resolve a stored SharePoint file URL to the file's CURRENT location via Graph.
 *
 * Stored links (from the Document Index) are static paths that 404 when a file is
 * renamed or re-revved. This resolves them live:
 *   1. Ask Graph for the driveItem of the stored URL (/shares).
 *   2. If gone, resolve the PARENT folder and find the file whose name starts with
 *      the document-number core (handles revision drift), newest first.
 * Returns the live webUrl, or null if it genuinely can't be found.
 */
import { graphFetch } from './graph'

function shareId(url: string): string {
  const b64 = Buffer.from(url, 'utf8').toString('base64')
  return 'u!' + b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

async function shareItem(url: string): Promise<any | null> {
  try {
    const r = await graphFetch(`/shares/${shareId(url)}/driveItem?$select=id,name,webUrl,parentReference`)
    return r.ok ? await r.json() : null
  } catch { return null }
}

export async function resolveOpenUrl(storedUrl: string | null, docCore: string | null): Promise<string | null> {
  if (!storedUrl) return null

  // 1. exact item still there?
  const di = await shareItem(storedUrl)
  if (di?.webUrl) return di.webUrl

  // 2. repair: look in the parent folder for the same document number (any revision)
  const slash = storedUrl.lastIndexOf('/')
  if (slash < 0 || !docCore) return null
  const pf = await shareItem(storedUrl.slice(0, slash))
  const driveId = pf?.parentReference?.driveId
  if (!pf?.id || !driveId) return null
  try {
    const r = await graphFetch(`/drives/${driveId}/items/${pf.id}/children?$select=name,webUrl&$top=400`)
    if (!r.ok) return null
    const kids: any[] = (await r.json()).value ?? []
    const core = docCore.toUpperCase()
    const matches = kids.filter(k => (k.name || '').toUpperCase().startsWith(core))
    if (!matches.length) return null
    matches.sort((a, b) => (a.name < b.name ? 1 : -1))   // newest revision (highest suffix) first
    return matches[0].webUrl ?? null
  } catch { return null }
}
