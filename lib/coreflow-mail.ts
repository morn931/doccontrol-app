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

import { LOGO_MARK_B64 } from './coreflow-mail-logo'

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

/**
 * Wrap content in the standard Coreflow email chrome: navy header with the inline
 * logo + module chip, teal accent, white card, muted footer — the Coreflow palette.
 * Reference the logo via cid:coreflowmark; sendMail() auto-attaches it inline.
 */
export function brandedEmail(opts: {
  heading: string
  bodyHtml: string
  cta?: { href: string; label: string }
}): string {
  const btn = opts.cta
    ? `<tr><td style="padding-top:10px"><a href="${opts.cta.href}" style="display:inline-block;background:#00B8C4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px">${opts.cta.label}</a></td></tr>`
    : ''
  return `
  <div style="background:#eef1f5;padding:28px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08)">
      <tr><td style="background:#1B3464;padding:18px 26px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle">
            <img src="cid:coreflowmark" width="26" height="26" alt="" style="vertical-align:middle;display:inline-block;border:0"/>
            <span style="vertical-align:middle;color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.4px;padding-left:9px">Coreflow</span>
          </td>
          <td style="vertical-align:middle;text-align:right">
            <span style="display:inline-block;background:rgba(0,184,196,.18);color:#7fe3ec;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:5px 11px;border-radius:999px">${MODULE}</span>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="height:3px;background:linear-gradient(90deg,#00B8C4,#0097A3)"></td></tr>
      <tr><td style="padding:30px 30px 26px">
        <h1 style="margin:0 0 14px;color:#1B3464;font-size:19px;font-weight:700">${opts.heading}</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="color:#374151;font-size:14px;line-height:1.6">
          <tr><td>${opts.bodyHtml}</td></tr>
          ${btn}
        </table>
      </td></tr>
      <tr><td style="padding:16px 30px;background:#f7f9fb;border-top:1px solid #edf0f3">
        <p style="margin:0;color:#9aa4b2;font-size:11px;line-height:1.5">
          Automated message from <span style="color:#1B3464;font-weight:600">Coreflow</span> — ${MODULE}. Please don't reply to this address.<br/>
          Coreflow · project delivery platform · <a href="https://coreflow.build" style="color:#0097A3;text-decoration:none">coreflow.build</a>
        </p>
      </td></tr>
    </table>
  </div>`
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
  const graphAttachments: Record<string, unknown>[] = (p.attachments ?? []).map(a => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.name,
    contentType: a.contentType,
    contentBytes: a.contentBytes,
  }))
  // Auto-attach the Coreflow logo inline when the body references it (branded emails).
  if (p.htmlBody.includes('cid:coreflowmark')) {
    graphAttachments.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'coreflow-mark.png',
      contentType: 'image/png',
      contentId: 'coreflowmark',
      isInline: true,
      contentBytes: LOGO_MARK_B64,
    })
  }
  if (graphAttachments.length) message.attachments = graphAttachments

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
