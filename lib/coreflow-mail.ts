// Server-only. Single Coreflow email sender.
//
// Every email leaving ANY Coreflow module goes through a helper like this one and
// is sent via Microsoft Graph as ONE identity — projects@coreflow.build — using the
// dedicated "Coreflow Mail Sender" Azure AD app (tenant db5ca55f…, app c02e35b6…),
// locked down (Application Access Policy) so it can ONLY send as projects@.
//
// IMPORTANT: this is SEPARATE from CoreDocs' PPE Graph app (lib/services/graph.ts),
// which stays on PPE's tenant for SharePoint document operations. Only email moved.
//
// Required env vars:
//   COREFLOW_MAIL_TENANT_ID
//   COREFLOW_MAIL_CLIENT_ID
//   COREFLOW_MAIL_CLIENT_SECRET
//   COREFLOW_MAIL_FROM        (defaults to projects@coreflow.build)
//
// Every subject is auto-prefixed with the sending module, e.g. "CoreDocs — …".

const TENANT_ID     = process.env.COREFLOW_MAIL_TENANT_ID!
const CLIENT_ID     = process.env.COREFLOW_MAIL_CLIENT_ID!
const CLIENT_SECRET = process.env.COREFLOW_MAIL_CLIENT_SECRET!
const FROM          = process.env.COREFLOW_MAIL_FROM || 'projects@coreflow.build'

// The module this app sends as.
const MODULE = 'CoreDocs'

let _t: { token: string; exp: number } | null = null

async function getGraphToken(): Promise<string> {
  if (_t && Date.now() < _t.exp - 60_000) return _t.token
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
      }),
    },
  )
  if (!res.ok) throw new Error(`Graph token: ${await res.text()}`)
  const d = await res.json()
  _t = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 }
  return _t.token
}

export type MailAttachment = {
  name: string
  contentType: string
  /** base64-encoded file bytes */
  contentBytes: string
}

/** Prefix a subject with the sending module (idempotent). */
export function withModulePrefix(subject: string): string {
  const prefix = `${MODULE} — `
  return subject.startsWith(prefix) ? subject : `${prefix}${subject}`
}

export async function sendMail(p: {
  to: string | string[]
  cc?: string | string[]
  subject: string
  htmlBody: string
  attachments?: MailAttachment[]
}): Promise<void> {
  const toList = (Array.isArray(p.to) ? p.to : [p.to]).filter(Boolean)
  const ccList = (p.cc ? (Array.isArray(p.cc) ? p.cc : [p.cc]) : []).filter(Boolean)
  if (!toList.length) return
  const token = await getGraphToken()

  const message: Record<string, unknown> = {
    subject: withModulePrefix(p.subject),
    body: { contentType: 'HTML', content: p.htmlBody },
    toRecipients: toList.map(e => ({ emailAddress: { address: e } })),
    ccRecipients: ccList.map(e => ({ emailAddress: { address: e } })),
  }
  if (p.attachments?.length) {
    message.attachments = p.attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }))
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(FROM)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true }),
    },
  )
  if (!res.ok && res.status !== 202) throw new Error(`sendMail: ${await res.text()}`)
}
