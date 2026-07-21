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
const INTERNAL_REVIEW_LIBRARY = process.env.INTERNAL_REVIEW_LIBRARY || 'Internal Reviews'
export async function uploadBytesToLibrary(
  fileName: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType = 'application/pdf',
  libraryName: string = INTERNAL_REVIEW_LIBRARY
): Promise<{ webUrl: string; id: string }> {
  const siteId  = await getSiteId(DOCCONTROL_SITE_URL)
  const driveId = await getLibraryDriveId(siteId, libraryName)
  const res = await graphFetch(
    `/sites/${siteId}/drives/${driveId}/root:/${encodeURIComponent(fileName)}:/content`,
    { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes as any }
  )
  if (!res.ok) throw new Error(`Upload to "${libraryName}" failed (${res.status}): ${await res.text()}`)
  const item = await res.json()
  return { webUrl: item.webUrl, id: item.id }
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
