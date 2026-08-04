/**
 * Microsoft Graph API Service
 * Server-side only — never import in client components.
 * Handles: auth token, file copy, file content, SharePoint item metadata, email sending.
 * NOTE: email now delegates to the unified Coreflow sender (../coreflow-mail); this
 * PPE Graph app is retained for SharePoint operations only.
 */
import { sendMail } from '../coreflow-mail'

const TENANT_ID    = process.env.MICROSOFT_TENANT_ID!
const CLIENT_ID    = process.env.MICROSOFT_CLIENT_ID!
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET!
const DOCCONTROL_SITE_URL = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!

let _tokenCache: { token: string; expiresAt: number } | null = null
let _spTokenCache: { token: string; expiresAt: number } | null = null

/** Get a cached app-only access token for Microsoft Graph */
export async function getGraphToken(): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph token error: ${err}`)
  }
  const data = await res.json()
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return _tokenCache.token
}

export async function graphFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getGraphToken()
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

/**
 * Get a cached app-only access token scoped to SharePoint REST API.
 * Required for /_api/* endpoints — Graph tokens (graph.microsoft.com) won't work there.
 */
export async function getSharePointToken(): Promise<string> {
  if (_spTokenCache && Date.now() < _spTokenCache.expiresAt - 60_000) {
    return _spTokenCache.token
  }
  const tenantHost = new URL(DOCCONTROL_SITE_URL).hostname
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         `https://${tenantHost}/.default`,
      }),
    }
  )
  if (!res.ok) throw new Error(`SharePoint token error: ${await res.text()}`)
  const data = await res.json()
  _spTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return _spTokenCache.token
}

/** Get the SharePoint site ID from a site URL */
export async function getSiteId(siteUrl: string): Promise<string> {
  const url = new URL(siteUrl)
  const host = url.hostname
  const path = url.pathname
  const res = await graphFetch(`/sites/${host}:${path}`)
  if (!res.ok) throw new Error(`Failed to get site ID for ${siteUrl}: ${await res.text()}`)
  const data = await res.json()
  return data.id
}

/** Get the default drive ID for a SharePoint site */
export async function getDriveId(siteId: string): Promise<string> {
  const res = await graphFetch(`/sites/${siteId}/drive`)
  if (!res.ok) throw new Error(`Failed to get drive: ${await res.text()}`)
  const data = await res.json()
  return data.id
}

/** Get file content as ArrayBuffer by SharePoint server-relative URL */
export async function getFileContent(siteUrl: string, serverRelativeUrl: string): Promise<ArrayBuffer> {
  const siteId = await getSiteId(siteUrl)
  const encodedPath = encodeURIComponent(serverRelativeUrl)
  const res = await graphFetch(`/sites/${siteId}/drive/root:${encodedPath}:/content`)
  if (!res.ok) throw new Error(`Failed to get file content: ${await res.text()}`)
  return res.arrayBuffer()
}

/** Get file bytes straight from a full SharePoint file URL (via the /shares endpoint,
 *  so we don't need to parse site/drive/path ourselves). Used to stream the PDF into
 *  the in-app markup editor. */
export async function getFileBytesByUrl(fileUrl: string): Promise<ArrayBuffer> {
  const encoded = Buffer.from(fileUrl).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const res = await graphFetch(`/shares/u!${encoded}/driveItem/content`)
  if (!res.ok) throw new Error(`Failed to fetch file bytes (${res.status}): ${await res.text()}`)
  return res.arrayBuffer()
}

const shareId = (fileUrl: string) => 'u!' + Buffer.from(fileUrl).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

/** Resolve any SharePoint file / sharing / "…Doc.aspx?sourcedoc=" URL to its real
 *  Graph driveItem (id, actual name, mime type, driveId). Handles the viewer-URL
 *  case where the path extension (.aspx) doesn't reflect the real file. */
export async function resolveDriveItemByUrl(fileUrl: string): Promise<{ id: string; name: string; mimeType?: string; driveId?: string; webUrl?: string } | null> {
  const res = await graphFetch(`/shares/${shareId(fileUrl)}/driveItem?$select=id,name,file,parentReference,webUrl`)
  if (!res.ok) return null
  const j = await res.json()
  return { id: j.id, name: j.name, mimeType: j.file?.mimeType, driveId: j.parentReference?.driveId, webUrl: j.webUrl }
}

/** Result of a delete attempt. Idempotent by design: a file that is already gone is a
 *  SUCCESS ('already_gone'), never an error — so reject cleanup can be retried safely. */
export type DeleteResult = { ok: boolean; status: 'deleted' | 'already_gone' | 'error'; detail?: string }

/** Hard-delete a SharePoint file by its full URL (resolves to the real Graph driveItem
 *  first, so viewer / sharing URLs work too). Idempotent: unresolvable or 404 → treated
 *  as already-gone. Used to remove the rejected copy from the DocumentControl
 *  "Documents for Approval" bucket. */
export async function deleteDriveItemByUrl(fileUrl: string): Promise<DeleteResult> {
  try {
    const item = await resolveDriveItemByUrl(fileUrl)
    if (!item || !item.driveId) return { ok: true, status: 'already_gone', detail: 'unresolvable' }
    const res = await graphFetch(`/drives/${item.driveId}/items/${item.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) return { ok: true, status: 'deleted' }
    if (res.status === 404) return { ok: true, status: 'already_gone' }
    return { ok: false, status: 'error', detail: `${res.status} ${await res.text()}` }
  } catch (e: any) {
    return { ok: false, status: 'error', detail: e?.message ?? String(e) }
  }
}

/** Hard-delete a SharePoint file by its site + server-relative path. Mirrors the
 *  source-read addressing used by copyFileToDocControl (default-drive `root:`), so it
 *  targets the very item intake originally read. Idempotent (404 → already-gone). Used
 *  to clear the vendor's FROM VENDOR copy on reject so a corrected re-upload lands as a
 *  fresh CREATE and re-triggers the intake watcher. */
export async function deleteFileBySiteAndPath(siteUrl: string, serverRelativeUrl: string): Promise<DeleteResult> {
  try {
    const siteId = await getSiteId(siteUrl)
    const normalizedPath = serverRelativeUrl.startsWith('/') ? serverRelativeUrl : `/${serverRelativeUrl}`
    const encodedPath = normalizedPath.split('/').map(s => encodeURIComponent(s)).join('/')
    const res = await graphFetch(`/sites/${siteId}/drive/root:${encodedPath}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) return { ok: true, status: 'deleted' }
    if (res.status === 404) return { ok: true, status: 'already_gone' }
    return { ok: false, status: 'error', detail: `${res.status} ${await res.text()}` }
  } catch (e: any) {
    return { ok: false, status: 'error', detail: e?.message ?? String(e) }
  }
}

export type MoveResult = { ok: boolean; status: 'moved' | 'already_moved' | 'already_gone' | 'error'; detail?: string }

/** Move a vendor's rejected file OUT of the active FROM VENDOR drop-off into a
 *  "Rejected Files" folder in the SAME library (same drive → clean atomic move). The
 *  file is preserved, not deleted — the vendor can still see it, so there's no "you
 *  deleted our document" dispute — but it leaves the drop-off root, forcing a fresh
 *  re-upload after corrections. Because the move keeps the item's id (and the intake
 *  watcher only fires on the library root anyway), this does NOT re-trigger intake.
 *  The "Rejected Files" folder is auto-created on first use. Idempotent: already-moved
 *  / already-gone == success.
 *
 *  `siteRelativePath` is the path as stored in document_versions.source_file_url —
 *  "<DropOffLibrary>/<…>/file.pdf" (the FIRST segment is the drop-off library's name,
 *  which varies per vendor: "FROM VENDOR", "From ABB", "FROM SIEMENS", …). The library
 *  is derived from that path, so no per-site config is needed; if that library was
 *  renamed since intake, it falls back to searching the site's drop-off libraries. */
export async function moveFileToRejectedFolder(
  siteUrl: string,
  siteRelativePath: string,
  rejectedFolder = 'Rejected Files'
): Promise<MoveResult> {
  try {
    const clean = siteRelativePath.replace(/^\/+/, '')
    const segs = clean.split('/').filter(Boolean)
    if (segs.length < 2) return { ok: false, status: 'error', detail: `cannot derive library from path "${siteRelativePath}"` }
    const libraryName = segs[0]
    const inLibPath = segs.slice(1).join('/')

    const siteId = await getSiteId(siteUrl)
    const encPath = inLibPath.split('/').map(encodeURIComponent).join('/')

    // 1 — locate the file. Primary: the library recorded in the path. Fallback (handles
    //     drop-off libraries RENAMED since intake — e.g. "FROM VENDOR" → "FROM SIEMENS"):
    //     probe the site's other drop-off-style libraries for the same in-library path,
    //     which survives a rename, so the moved file still resolves.
    let driveId: string | null = null
    let src: any = null
    const tryResolve = async (dId: string) => {
      const r = await graphFetch(`/drives/${dId}/root:/${encPath}?$select=id,name,parentReference`)
      return r.ok ? await r.json() : null
    }
    try {
      const primary = await getLibraryDriveId(siteId, libraryName)
      const hit = await tryResolve(primary)
      if (hit) { driveId = primary; src = hit }
    } catch { /* recorded library no longer exists — fall through to search */ }

    if (!src) {
      const drRes = await graphFetch(`/sites/${siteId}/drives`)
      const drives: any[] = drRes.ok ? ((await drRes.json()).value ?? []) : []
      const isDropOff = (n: string) => /^from\b/i.test(n) || /drop/i.test(n)
      for (const d of drives) {
        if (!isDropOff(d.name ?? '')) continue
        const hit = await tryResolve(d.id)
        if (hit) { driveId = d.id; src = hit; break }
      }
    }

    if (!src || !driveId) return { ok: true, status: 'already_gone' }   // not in any drop-off library
    if (String(src.parentReference?.path ?? '').endsWith('/' + rejectedFolder)) return { ok: true, status: 'already_moved' }

    // 2 — ensure the Rejected Files folder exists in this drive's root (get-or-create)
    let folderId: string | null = null
    const g = await graphFetch(`/drives/${driveId}/root:/${encodeURIComponent(rejectedFolder)}?$select=id`)
    if (g.ok) folderId = (await g.json()).id
    else {
      const mk = await graphFetch(`/drives/${driveId}/root/children`, {
        method: 'POST',
        body: JSON.stringify({ name: rejectedFolder, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
      })
      if (mk.ok) folderId = (await mk.json()).id
      else {
        const g2 = await graphFetch(`/drives/${driveId}/root:/${encodeURIComponent(rejectedFolder)}?$select=id`)
        if (g2.ok) folderId = (await g2.json()).id
      }
    }
    if (!folderId) return { ok: false, status: 'error', detail: 'could not create/find the Rejected Files folder' }

    // 3 — same-drive move; on a name clash in the folder, suffix the name
    const move = (name?: string) => graphFetch(`/drives/${driveId}/items/${src.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentReference: { id: folderId }, ...(name ? { name } : {}) }),
    })
    let mv = await move()
    if (mv.status === 409) {
      const dot = String(src.name).lastIndexOf('.')
      const base = dot > 0 ? src.name.slice(0, dot) : src.name
      const ext = dot > 0 ? src.name.slice(dot) : ''
      mv = await move(`${base} (rejected ${Date.now()})${ext}`)
    }
    if (mv.ok) return { ok: true, status: 'moved' }
    return { ok: false, status: 'error', detail: `move: ${mv.status} ${(await mv.text()).slice(0, 200)}` }
  } catch (e: any) {
    return { ok: false, status: 'error', detail: e?.message ?? String(e) }
  }
}

/** Mint a short-lived, embeddable Office-for-the-web URL (read-only) for a SharePoint file
 *  via the Graph `preview` action. Dropped into an <iframe>, it renders the REAL Word/Excel/
 *  PPT/PDF inside our own window — no SharePoint sign-in, no landing in the library on close.
 *  The token is short-lived, so call this per view (never store the URL). */
export async function getOfficeEmbedUrl(fileUrl: string): Promise<string> {
  const item = await resolveDriveItemByUrl(fileUrl)
  if (!item?.driveId) throw new Error('Could not locate the file in SharePoint.')
  const res = await graphFetch(`/drives/${item.driveId}/items/${item.id}/preview`, { method: 'POST', body: JSON.stringify({}) })
  if (!res.ok) throw new Error(`preview failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  if (!data.getUrl) throw new Error('No embed URL returned by Graph preview.')
  return data.getUrl as string
}

/** Download a driveItem's content bytes — optionally converted (format='pdf' renders
 *  Office docs to PDF so they display inline in a browser). */
export async function getDriveItemContentBytes(driveId: string, itemId: string, format?: string): Promise<ArrayBuffer> {
  const res = await graphFetch(`/drives/${driveId}/items/${itemId}/content${format ? `?format=${format}` : ''}`)
  if (!res.ok) throw new Error(`Failed to fetch driveItem content (${res.status}): ${await res.text()}`)
  return res.arrayBuffer()
}

/** Replace a SharePoint file's content in place from a full file URL (simple upload,
 *  fine for the < ~4 MB flattened spec PDFs). SharePoint stays authoritative — this
 *  writes the marked-up copy back so the next reviewer sees prior mark-ups. */
export async function putFileBytesByUrl(fileUrl: string, bytes: Uint8Array | ArrayBuffer, contentType = 'application/pdf'): Promise<void> {
  const encoded = Buffer.from(fileUrl).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const res = await graphFetch(`/shares/u!${encoded}/driveItem/content`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes as any,
  })
  if (!res.ok) throw new Error(`Failed to write file bytes (${res.status}): ${await res.text()}`)
}

/** Replace a SharePoint file via a resumable upload session — for flattened PDFs above
 *  the ~4 MB simple-upload limit. Creates the session then PUTs the bytes as a single
 *  range to the pre-authorised upload URL (no auth header needed on that URL). */
export async function putFileBytesResumable(fileUrl: string, bytes: Uint8Array, contentType = 'application/pdf'): Promise<void> {
  const encoded = Buffer.from(fileUrl).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const sess = await graphFetch(`/shares/u!${encoded}/driveItem/createUploadSession`, {
    method: 'POST',
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  })
  if (!sess.ok) throw new Error(`createUploadSession failed (${sess.status}): ${await sess.text()}`)
  const { uploadUrl } = await sess.json()
  const total = bytes.byteLength
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(total), 'Content-Range': `bytes 0-${total - 1}/${total}`, 'Content-Type': contentType },
    body: bytes as any,
  })
  if (!put.ok) throw new Error(`Resumable upload failed (${put.status}): ${await put.text()}`)
}

/** Get file metadata (id, name, webUrl) by server-relative URL */
export async function getFileMetadata(siteUrl: string, serverRelativeUrl: string): Promise<any> {
  const siteId = await getSiteId(siteUrl)
  const res = await graphFetch(`/sites/${siteId}/drive/root:${serverRelativeUrl}`)
  if (!res.ok) throw new Error(`Failed to get file metadata: ${await res.text()}`)
  return res.json()
}

/**
 * Find a document library drive by name within a SharePoint site.
 * Each library in SharePoint is a separate "drive" in Graph API.
 * The targetLibraryPath is the library name (e.g. "/K108  Battery Energy Storage System").
 */
async function getLibraryDriveId(siteId: string, libraryName: string): Promise<string> {
  const res = await graphFetch(`/sites/${siteId}/drives`)
  if (!res.ok) throw new Error(`Failed to list drives: ${await res.text()}`)
  const data = await res.json()
  const normalize = (s: string) => s.replace(/^\//, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const target = normalize(libraryName)
  const drive  = data.value?.find((d: any) =>
    normalize(d.name) === target || normalize(d.webUrl?.split('/').pop() ?? '') === target
  )
  if (!drive) {
    const names = data.value?.map((d: any) => d.name).join(', ')
    throw new Error(`Library "${libraryName}" not found. Available: ${names}`)
  }
  return drive.id
}

/**
 * Copy a file from a vendor SharePoint site to the correct DocumentControl library.
 *
 * IMPORTANT: In DocumentControl, each package has its own document library
 * (e.g. "K108  Battery Energy Storage System"). These are separate drives in Graph API,
 * NOT folders inside the default Shared Documents drive.
 *
 * The targetLibraryPath is the library name as it appears in SharePoint
 * (e.g. "/K108  Battery Energy Storage System" — note double space).
 */
export async function copyFileToDocControl(
  sourceSiteUrl: string,
  sourceRelativeUrl: string,
  targetLibraryPath: string,
  fileName: string
): Promise<{ id: string; webUrl: string; driveItemId: string }> {
  const sourceSiteId = await getSiteId(sourceSiteUrl)
  const targetSiteId = await getSiteId(DOCCONTROL_SITE_URL)

  // Get the SOURCE file — path is relative to the vendor library root
  const normalizedPath = sourceRelativeUrl.startsWith('/') ? sourceRelativeUrl : `/${sourceRelativeUrl}`
  const encodedPath    = normalizedPath.split('/').map(s => encodeURIComponent(s)).join('/')
  const srcRes = await graphFetch(`/sites/${sourceSiteId}/drive/root:${encodedPath}`)
  if (!srcRes.ok) throw new Error(`Source file not found [${encodedPath}]: ${await srcRes.text()}`)
  const srcItem = await srcRes.json()

  // Get the TARGET library drive — each package library is its own drive
  const targetDriveId = await getLibraryDriveId(targetSiteId, targetLibraryPath)

  // Copy to root of the target library drive
  const copyBody = {
    parentReference: { driveId: targetDriveId, itemId: 'root' },
    name: fileName,
  }
  const copyRes = await graphFetch(
    `/sites/${sourceSiteId}/drive/items/${srcItem.id}/copy`,
    { method: 'POST', body: JSON.stringify(copyBody) }
  )
  if (!copyRes.ok && copyRes.status !== 202) {
    throw new Error(`Failed to copy file: ${await copyRes.text()}`)
  }

  // Poll the async copy operation for completion
  const monitorUrl = copyRes.headers.get('Location')
  if (monitorUrl) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const pollRes  = await fetch(monitorUrl)
      const pollData = await pollRes.json()
      if (pollData.status === 'completed') {
        return { id: pollData.resourceId, webUrl: pollData.resourceLocation, driveItemId: pollData.resourceId }
      }
      if (pollData.status === 'failed') throw new Error(`Copy operation failed: ${JSON.stringify(pollData)}`)
    }
  }

  // Fallback: look up the file in the target library by name
  const findRes = await graphFetch(`/sites/${targetSiteId}/drives/${targetDriveId}/root:/${encodeURIComponent(fileName)}`)
  if (!findRes.ok) throw new Error(`Could not verify copied file in target library: ${await findRes.text()}`)
  const found = await findRes.json()
  return { id: found.id, webUrl: found.webUrl, driveItemId: found.id }
}

/**
 * Upload NEW file bytes (from a browser upload) into a document library in the
 * DocumentControl site — used by the internal-engineering driveway so the review
 * copy gets a SharePoint webUrl and the existing review engine (serve + mark-up +
 * write-back) works unchanged. Library name is env-configurable (default
 * "Internal Reviews"); it must exist in the DocumentControl site.
 */
const INTERNAL_REVIEW_LIBRARY  = process.env.INTERNAL_REVIEW_LIBRARY  || 'Internal Reviews'
const INTERNAL_REVIEW_SITE_URL = process.env.INTERNAL_REVIEW_SITE_URL || DOCCONTROL_SITE_URL

/** The PPE Engineering SharePoint site that holds the discipline libraries
 *  (ELECTRICAL, MECHANICAL, …) a reviewed internal document is placed into. */
export const ENGINEERING_SITE_URL = process.env.SHAREPOINT_ENGINEERING_SITE_URL
  || 'https://ppetechcoza.sharepoint.com/sites/ENG2'

/** List the document libraries (drives) in a SharePoint site — used to populate the
 *  "which discipline library" picker for the internal-return interlock. */
export async function listSiteLibraries(siteUrl: string = ENGINEERING_SITE_URL): Promise<string[]> {
  const siteId = await getSiteId(siteUrl)
  const res = await graphFetch(`/sites/${siteId}/drives?$select=name`)
  if (!res.ok) throw new Error(`Failed to list libraries (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return (data.value ?? []).map((d: any) => d.name as string).filter(Boolean).sort()
}
export async function uploadBytesToLibrary(
  fileName: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType = 'application/pdf',
  libraryName: string = INTERNAL_REVIEW_LIBRARY,
  siteUrl: string = INTERNAL_REVIEW_SITE_URL
): Promise<{ webUrl: string; id: string }> {
  const siteId  = await getSiteId(siteUrl)
  const driveId = await getLibraryDriveId(siteId, libraryName)
  const res = await graphFetch(
    `/sites/${siteId}/drives/${driveId}/root:/${encodeURIComponent(fileName)}:/content`,
    { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes as any }
  )
  if (!res.ok) throw new Error(`Upload to "${libraryName}" failed (${res.status}): ${await res.text()}`)
  const item = await res.json()
  return { webUrl: item.webUrl, id: item.id }
}

/** Upload bytes to a PATH inside a library (e.g. "Signed/DOC.pdf"), creating the file (or
 *  replacing it). Used for the sign-off PDF, which lives in Internal Reviews / Signed. */
export async function uploadBytesToLibraryFolder(
  pathInLibrary: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType = 'application/pdf',
  libraryName: string = INTERNAL_REVIEW_LIBRARY,
  siteUrl: string = INTERNAL_REVIEW_SITE_URL
): Promise<{ webUrl: string; id: string }> {
  const siteId  = await getSiteId(siteUrl)
  const driveId = await getLibraryDriveId(siteId, libraryName)
  const encPath = pathInLibrary.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')
  const res = await graphFetch(
    `/sites/${siteId}/drives/${driveId}/root:/${encPath}:/content`,
    { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes as any }
  )
  if (!res.ok) throw new Error(`Upload to "${libraryName}/${pathInLibrary}" failed (${res.status}): ${await res.text()}`)
  const item = await res.json()
  return { webUrl: item.webUrl, id: item.id }
}

/** The folder inside the Internal Reviews library that holds site redline
 *  uploads (driveway C front door). No new site/library needed. */
export const REDLINE_FOLDER = process.env.REDLINE_FOLDER || 'Site Redlines'

// ── Rev 0 intake helpers (2026-07-31): browse/write any site's library ───────
const encPath = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')

/** List a folder inside a named library on any SharePoint site. */
export async function listLibraryFolder(
  siteUrl: string, libraryName: string, relPath: string
): Promise<{ name: string; isFolder: boolean; size: number; webUrl: string }[]> {
  const siteId  = await getSiteId(siteUrl)
  const driveId = await getLibraryDriveId(siteId, libraryName)
  const base = relPath ? `/sites/${siteId}/drives/${driveId}/root:/${encPath(relPath)}:/children`
                       : `/sites/${siteId}/drives/${driveId}/root/children`
  const res = await graphFetch(`${base}?$select=name,size,folder,file,webUrl&$top=500`)
  if (!res.ok) throw new Error(`List "${libraryName}/${relPath}" failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return (data.value ?? []).map((i: any) => ({
    name: i.name, isFolder: !!i.folder, size: i.size ?? 0, webUrl: i.webUrl,
  }))
}

/** Resolve a library's DISPLAY name from a derived/URL-ish name. The bucket
 *  names recovered from the old flows are URL path segments ("K108  Battery
 *  Energy Storage System") while Graph matches display names ("K108 - Battery
 *  Energy Storage System") — compare with punctuation/whitespace stripped. */
export async function resolveLibraryName(siteUrl: string, wanted: string): Promise<string> {
  const siteId = await getSiteId(siteUrl)
  const res = await graphFetch(`/sites/${siteId}/drives?$select=name`)
  if (!res.ok) throw new Error(`Failed to list libraries (${res.status}): ${await res.text()}`)
  const names: string[] = ((await res.json()).value ?? []).map((d: any) => d.name).filter(Boolean)
  if (names.includes(wanted)) return wanted
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const w = norm(wanted)
  const exact = names.find(n => norm(n) === w)
  if (exact) return exact
  // URL segments can carry a recreation suffix ("…Overhead Lines 2" vs the
  // display "…Overhead Lines") — accept a containment match only if UNIQUE.
  const contains = names.filter(n => { const x = norm(n); return x.startsWith(w) || w.startsWith(x) })
  if (contains.length === 1) return contains[0]
  throw new Error(`Library "${wanted}" not found. Available: ${names.join(', ')}`)
}

/** Chunked upload session for a path in a named library on any site —
 *  conflictBehavior 'replace' overwrites in place (the stamped Rev 0 replaces
 *  the vendor's unstamped copy). */
export async function createSessionForSitePath(
  siteUrl: string, libraryName: string, relPath: string
): Promise<{ uploadUrl: string }> {
  const siteId  = await getSiteId(siteUrl)
  const driveId = await getLibraryDriveId(siteId, libraryName)
  const res = await graphFetch(
    `/sites/${siteId}/drives/${driveId}/root:/${encPath(relPath)}:/createUploadSession`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) }
  )
  if (!res.ok) {
    const text = await res.text()
    // A failed earlier attempt can leave a pending upload session that locks
    // the filename; SharePoint expires it by itself within ~15 minutes.
    if (res.status === 409 && /being uploaded/i.test(text)) {
      throw new Error(
        `SharePoint still holds a temporary upload lock on "${relPath.split('/').pop()}" from an earlier attempt — ` +
        `it clears automatically within ~15 minutes. Please try again shortly.`)
    }
    throw new Error(`createUploadSession "${libraryName}/${relPath}" failed (${res.status}): ${text}`)
  }
  const data = await res.json()
  return { uploadUrl: data.uploadUrl }
}

/** Create a Graph upload session for a nested path in the DocumentControl
 *  library — the browser PUTs the chunks straight to the returned uploadUrl,
 *  dodging Vercel's request-body cap for big scans. Per-segment encoding so
 *  folder paths survive; Graph auto-creates missing parent folders. */
export async function createLibraryUploadSession(
  relPath: string,
  libraryName: string = INTERNAL_REVIEW_LIBRARY,
  siteUrl: string = INTERNAL_REVIEW_SITE_URL
): Promise<{ uploadUrl: string }> {
  const siteId  = await getSiteId(siteUrl)
  const driveId = await getLibraryDriveId(siteId, libraryName)
  const enc = relPath.split('/').map(encodeURIComponent).join('/')
  const res = await graphFetch(
    `/sites/${siteId}/drives/${driveId}/root:/${enc}:/createUploadSession`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }) }
  )
  if (!res.ok) throw new Error(`createUploadSession for "${relPath}" failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return { uploadUrl: data.uploadUrl }
}

/**
 * Send an email — now routed through the unified Coreflow sender
 * (projects@coreflow.build) via lib/coreflow-mail.ts, NOT the PPE Graph app above.
 * Signature preserved so all callers (review-assigned, review-complete, batch-rejected,
 * vendor transmittal + PDF) are unchanged; subjects auto-prefixed "CoreDocs — ".
 * `fromUserId` is retained for compatibility but IGNORED (mailbox locked to projects@).
 */
export async function sendEmail(params: {
  to: string | string[]
  cc?: string | string[]
  subject: string
  htmlBody: string
  fromUserId?: string
  attachments?: Array<{ name: string; contentType: string; content: Buffer | string }>
}): Promise<void> {
  await sendMail({
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    htmlBody: params.htmlBody,
    attachments: params.attachments?.map(a => ({
      name: a.name,
      contentType: a.contentType,
      contentBytes: Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : Buffer.from(a.content as string, 'binary').toString('base64'),
    })),
  })
}
