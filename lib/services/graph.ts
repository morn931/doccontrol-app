/**
 * Microsoft Graph API Service
 * Server-side only — never import in client components.
 * Handles: auth token, file copy, file content, SharePoint item metadata, email sending.
 */

const TENANT_ID    = process.env.MICROSOFT_TENANT_ID!
const CLIENT_ID    = process.env.MICROSOFT_CLIENT_ID!
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET!
const DOCCONTROL_SITE_URL = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL!

let _tokenCache: { token: string; expiresAt: number } | null = null

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

async function graphFetch(path: string, options: RequestInit = {}): Promise<Response> {
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

/** Get file metadata (id, name, webUrl) by server-relative URL */
export async function getFileMetadata(siteUrl: string, serverRelativeUrl: string): Promise<any> {
  const siteId = await getSiteId(siteUrl)
  const res = await graphFetch(`/sites/${siteId}/drive/root:${serverRelativeUrl}`)
  if (!res.ok) throw new Error(`Failed to get file metadata: ${await res.text()}`)
  return res.json()
}

/** 
 * Copy a file from a vendor SharePoint site to the DocumentControl site.
 * Returns the new item's metadata (id, webUrl, eTag).
 */
export async function copyFileToDocControl(
  sourceSiteUrl: string,
  sourceRelativeUrl: string,
  targetLibraryPath: string,
  fileName: string
): Promise<{ id: string; webUrl: string; driveItemId: string }> {
  const sourceSiteId   = await getSiteId(sourceSiteUrl)
  const targetSiteId   = await getSiteId(DOCCONTROL_SITE_URL)
  const targetDriveId  = await getDriveId(targetSiteId)

  // Get source item ID — ensure path starts with / and encode each segment
  const normalizedPath = sourceRelativeUrl.startsWith('/') ? sourceRelativeUrl : `/${sourceRelativeUrl}`
  const encodedPath = normalizedPath.split('/').map(s => encodeURIComponent(s)).join('/')
  const srcRes = await graphFetch(`/sites/${sourceSiteId}/drive/root:${encodedPath}`)
  if (!srcRes.ok) throw new Error(`Source file not found [${encodedPath}]: ${await srcRes.text()}`)
  const srcItem = await srcRes.json()

  // Copy to target
  const copyBody = {
    parentReference: { driveId: targetDriveId, path: `/root:${targetLibraryPath}` },
    name: fileName,
  }
  const copyRes = await graphFetch(
    `/sites/${sourceSiteId}/drive/items/${srcItem.id}/copy`,
    { method: 'POST', body: JSON.stringify(copyBody) }
  )
  if (!copyRes.ok && copyRes.status !== 202) {
    throw new Error(`Failed to copy file: ${await copyRes.text()}`)
  }

  // Poll for completion (copy is async)
  const monitorUrl = copyRes.headers.get('Location')
  if (monitorUrl) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const pollRes = await fetch(monitorUrl)
      const pollData = await pollRes.json()
      if (pollData.status === 'completed') {
        return { id: pollData.resourceId, webUrl: pollData.resourceLocation, driveItemId: pollData.resourceId }
      }
      if (pollData.status === 'failed') throw new Error(`Copy failed: ${JSON.stringify(pollData)}`)
    }
  }

  // Fallback: find the file in the target
  const findRes = await graphFetch(`/sites/${targetSiteId}/drive/root:${targetLibraryPath}/${fileName}`)
  if (!findRes.ok) throw new Error('Could not verify file was copied')
  const found = await findRes.json()
  return { id: found.id, webUrl: found.webUrl, driveItemId: found.id }
}

/** Send an email via Microsoft Graph (as the app / service account) */
export async function sendEmail(params: {
  to: string | string[]
  cc?: string | string[]
  subject: string
  htmlBody: string
  fromUserId?: string  // UPN of sender (defaults to controller)
}): Promise<void> {
  const toList = Array.isArray(params.to) ? params.to : [params.to]
  const ccList = params.cc ? (Array.isArray(params.cc) ? params.cc : [params.cc]) : []

  // Send as the app using /users/{from}/sendMail — requires Mail.Send permission
  const fromUser = params.fromUserId ?? process.env.CONTROLLER_EMAIL ?? 'liezlc@ppetech.co.za'

  const mailBody = {
    message: {
      subject: params.subject,
      body: { contentType: 'HTML', content: params.htmlBody },
      toRecipients:  toList.filter(Boolean).map(e => ({ emailAddress: { address: e } })),
      ccRecipients:  ccList.filter(Boolean).map(e => ({ emailAddress: { address: e } })),
    },
    saveToSentItems: true,
  }

  const res = await graphFetch(`/users/${fromUser}/sendMail`, {
    method: 'POST',
    body: JSON.stringify(mailBody),
  })
  if (!res.ok && res.status !== 202) {
    const err = await res.text()
    throw new Error(`Failed to send email to ${toList.join(',')}: ${err}`)
  }
}
