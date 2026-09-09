// HOURLY BOUNCE SELF-CHECK for the platform sender projects@coreflow.build.
//
// 8 Sep 2026, 16:20: Exchange Online Protection put projects@ on Restricted entities.
// Graph kept answering 202 to every sendMail, so every app believed its mail had gone,
// and every message bounced back INTO the projects@ Inbox as an NDR
//   "550 5.1.8 Access denied, bad outbound sender AS(42004)"
// that nobody read for eighteen hours. Two RDMC portal invitations, two PPC sign-off
// requests, review notices, the overdue chase and the morning brief all vanished.
// No tenant alert fired (there is no alert policy for it in coreflow140).
//
// So the platform reads its own outbox. Once an hour this looks in the projects@
// mailbox for postmaster NDRs newer than the last one it handled and, if there are
// any, emails Morné from the PPE tenant (lib/prelim/mail.ts — a DIFFERENT sender and a
// different tenant, so the alert cannot be lost to the same fault it reports).
//
// Needs Mail.Read (application) on the "Coreflow Mail Sender" app in coreflow140,
// beside its existing Mail.Send. The tenant's ApplicationAccessPolicy already scopes
// that app to the projects@ mailbox, so Mail.Read reaches nothing else.
import { getGraphToken } from '@/lib/coreflow-mail'
import { sendPrelimMail, brandedEmail } from '@/lib/prelim/mail'

const MAILBOX = process.env.COREFLOW_MAIL_FROM || 'projects@coreflow.build'
const ALERT_TO = (process.env.MAIL_BOUNCE_ALERT_TO || 'mornec@ppetech.co.za').split(',').map(s => s.trim()).filter(Boolean)
const KEY_LAST_SEEN = 'mail_bounce_check_last_seen'          // receivedDateTime of the newest NDR handled
const KEY_LAST_RUN = 'mail_bounce_check_last_run'            // JSON summary of the last run
const KEY_ERR_ALERTED = 'mail_bounce_check_error_alerted_at' // throttles "the check itself is broken" to once a day

export type Bounce = {
  id: string
  receivedAt: string
  dsn: string | null
  senderBlocked: boolean
  recipients: string[]
  originalSubject: string | null
  detail: string | null
}

type Db = { from: (t: string) => any }

// Sender-side codes: the mailbox itself is refused, so EVERY message is lost until an
// admin acts. 5.1.8 = bad outbound sender (Restricted entities); 5.7.7xx = tenant/user
// outbound-spam restrictions. Anything else is about one recipient (bad address, full
// mailbox, their filter) and is worth knowing, not worth waking anyone for.
const SENDER_BLOCKED = /^5\.1\.8$|^5\.7\.7\d\d$/

// RFC 2047 encoded-word decoder — Exchange writes the original subject into the NDR
// body as =?Windows-1252?Q?CoreCost_=97_PPC_#5...?= and a human should not read that.
function decodeEncodedWords(s: string): string {
  // Whitespace BETWEEN two encoded words is not content (RFC 2047 §6.2) — strip it before
  // decoding, or a subject folded mid-word comes out as "Manageme nt".
  return s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _cs, enc, text) => {
    try {
      if (enc.toLowerCase() === 'b') return Buffer.from(text, 'base64').toString('utf8')
      const bytes = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x: string, h: string) => String.fromCharCode(parseInt(h, 16)))
      return bytes.replace(/\x97/g, '—').replace(/\x96/g, '–').replace(/\x92/g, '’')
    } catch { return text }
  }).replace(/\?=\s+=\?/g, '')
}

export function parseNdr(m: { id: string; receivedDateTime: string; body?: { content?: string }; bodyPreview?: string }): Bounce {
  const text = (m.body?.content ?? m.bodyPreview ?? '').replace(/\r/g, '')
  const dsn = text.match(/\b([45]\.\d\.\d{1,3})\b/)?.[1] ?? null
  const detail = text.match(/Remote server returned '([^']+)'/i)?.[1] ?? text.match(/(5\d\d [45]\.\d\.\d{1,3}[^\n]*)/)?.[1] ?? null
  const skip = /postmaster|microsoftexchange|noreply|no-reply/i
  const recipients = Array.from(new Set((text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])
    .map(e => e.toLowerCase())
    .filter(e => e !== MAILBOX.toLowerCase() && !skip.test(e) && !/\.(outlook|office365)\.com$/i.test(e.split('@')[1]))))
  const subj = text.match(/^Subject:\s*([\s\S]*?)\n(?:\S+:|\s*$)/m)?.[1]?.replace(/\n\s+/g, ' ').trim() ?? null
  return { id: m.id, receivedAt: m.receivedDateTime, dsn, senderBlocked: !!dsn && SENDER_BLOCKED.test(dsn), recipients, originalSubject: subj ? decodeEncodedWords(subj) : null, detail }
}

async function readSetting(db: Db, key: string): Promise<string | null> {
  const { data } = await db.from('system_settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as string | undefined) ?? null
}
async function writeSetting(db: Db, key: string, value: string) {
  await db.from('system_settings').upsert({ key, value }, { onConflict: 'key' })
}

// Read every message received in the mailbox since `since` (all folders — Junk included,
// since EOP has been known to file its own NDRs there) and keep the postmaster ones.
async function fetchNdrs(since: string): Promise<Bounce[]> {
  const token = await getGraphToken()
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages?` +
    `$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc&$top=100&$select=id,subject,receivedDateTime,from,body`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } })
  if (!res.ok) throw new Error(`Graph read of ${MAILBOX} failed: ${res.status} ${await res.text()}`)
  const rows: any[] = (await res.json()).value ?? []
  const isNdr = (m: any) => {
    const from = String(m.from?.emailAddress?.address ?? '').toLowerCase()
    const subj = String(m.subject ?? '')
    return from.includes('postmaster') || from.includes('microsoftexchange') || /^(undeliverable|delivery has failed|delivery status notification)/i.test(subj)
  }
  return rows.filter(isNdr).map(parseNdr)
}

const sast = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Johannesburg', hour12: false, ...opts })
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

function alertHtml(bounces: Bounce[], since: string): { subject: string; html: string } {
  const blocked = bounces.filter(b => b.senderBlocked)
  const rows = bounces.map(b =>
    `<tr><td style="padding:4px 8px;white-space:nowrap">${sast(b.receivedAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>` +
    `<td style="padding:4px 8px">${esc(b.recipients.join(', ') || '—')}</td>` +
    `<td style="padding:4px 8px;font-family:monospace;color:${b.senderBlocked ? '#b91c1c' : '#1e293b'}">${b.dsn ?? '?'}</td>` +
    `<td style="padding:4px 8px">${esc(b.originalSubject ?? '—')}</td></tr>`).join('')
  const table = `<table style="border-collapse:collapse;font-size:13px;width:100%"><thead><tr style="background:#f1f5f9"><th style="text-align:left;padding:4px 8px">Bounced</th><th style="text-align:left;padding:4px 8px">To</th><th style="text-align:left;padding:4px 8px">Code</th><th style="text-align:left;padding:4px 8px">Original subject</th></tr></thead><tbody>${rows}</tbody></table>`
  const sample = blocked[0]?.detail ?? bounces[0]?.detail
  const action = blocked.length
    ? `<p style="color:#b91c1c"><b>The sender itself is blocked.</b> Every message from ${MAILBOX} is being refused, whoever it is addressed to, until an admin unblocks it:</p>
       <ol><li>Sign in to <a href="https://security.microsoft.com/restrictedentities">security.microsoft.com → Email &amp; collaboration → Review → Restricted entities</a> as the coreflow.build admin.</li>
       <li>Select <b>${MAILBOX}</b> and choose <b>Unblock</b>. Delivery resumes within minutes.</li>
       <li>Everything sent since the first bounce below must be sent again — the apps believe it went.</li></ol>`
    : `<p>These look recipient-side (a bad address, a full mailbox, their filter) rather than a block on ${MAILBOX}. Check the addresses; no admin action is needed unless the codes change to 5.1.8 or 5.7.7xx.</p>`
  const n = bounces.length
  return {
    subject: blocked.length
      ? `${MAILBOX} is BLOCKED — ${n} bounce${n === 1 ? '' : 's'} since ${sast(since, { hour: '2-digit', minute: '2-digit' })} (${blocked[0].dsn})`
      : `${MAILBOX} bounced ${n} message${n === 1 ? '' : 's'} in the last hour`,
    html: brandedEmail({
      heading: blocked.length ? 'The platform sender is being refused' : 'Undeliverable platform mail',
      bodyHtml: `<p>The hourly self-check read the <b>${MAILBOX}</b> Inbox and found ${n} new non-delivery report${n === 1 ? '' : 's'}.</p>${action}${sample ? `<p style="font-family:monospace;font-size:12px;background:#f8fafc;padding:8px;border-radius:6px">${esc(sample)}</p>` : ''}${table}<p style="color:#64748b;font-size:12px">Sent from the PPE tenant on purpose, so this alert cannot be lost to the fault it reports. Source: CoreDocs /api/cron/mail-bounce-check.</p>`,
      cta: { href: 'https://outlook.office.com/mail/projects@coreflow.build/', label: 'Open the projects@ mailbox →' },
    }),
  }
}

export async function runMailBounceCheck(db: Db): Promise<{ ok: true; since: string; found: number; alerted: boolean; bounces: Bounce[] } | { ok: false; error: string; alerted: boolean }> {
  const now = new Date()
  const lastSeen = await readSetting(db, KEY_LAST_SEEN)
  // First run looks back two hours; after that, from the newest NDR already handled,
  // but never further back than a day (a long outage must not replay a week of NDRs).
  const floor = new Date(now.getTime() - 24 * 3600e3).toISOString()
  const since = lastSeen ? (lastSeen > floor ? lastSeen : floor) : new Date(now.getTime() - 2 * 3600e3).toISOString()

  let ndrs: Bounce[]
  try {
    ndrs = await fetchNdrs(since)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    // The check itself cannot run (Mail.Read not granted, token, Graph down). Say so —
    // once a day, from the PPE tenant — rather than silently checking nothing.
    const lastErr = await readSetting(db, KEY_ERR_ALERTED)
    let alerted = false
    if (!lastErr || Date.now() - new Date(lastErr).getTime() > 24 * 3600e3) {
      try {
        await sendPrelimMail({
          to: ALERT_TO,
          subject: `mail bounce self-check cannot read ${MAILBOX}`,
          htmlBody: brandedEmail({
            heading: 'The bounce self-check is not running',
            bodyHtml: `<p>CoreDocs could not read the ${MAILBOX} mailbox, so bounces are NOT being watched:</p><p style="font-family:monospace;font-size:12px;background:#f8fafc;padding:8px;border-radius:6px">${esc(error)}</p><p>A 403 here means the <b>Coreflow Mail Sender</b> app in the coreflow140 tenant lacks <b>Mail.Read</b> (application) with admin consent. Anything else: the Graph token or Microsoft itself.</p>`,
          }),
        })
        alerted = true
        await writeSetting(db, KEY_ERR_ALERTED, now.toISOString())
      } catch { /* the alert is best-effort; the JSON below still says what happened */ }
    }
    await writeSetting(db, KEY_LAST_RUN, JSON.stringify({ at: now.toISOString(), ok: false, error }))
    return { ok: false, error, alerted }
  }

  const fresh = ndrs.filter(b => b.receivedAt > since).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  let alerted = false
  if (fresh.length) {
    const { subject, html } = alertHtml(fresh, since)
    await sendPrelimMail({ to: ALERT_TO, subject, htmlBody: html })
    alerted = true
    await writeSetting(db, KEY_LAST_SEEN, fresh[fresh.length - 1].receivedAt)
  } else if (!lastSeen) {
    await writeSetting(db, KEY_LAST_SEEN, now.toISOString())
  }
  await writeSetting(db, KEY_LAST_RUN, JSON.stringify({ at: now.toISOString(), ok: true, since, found: fresh.length, alerted, senderBlocked: fresh.some(b => b.senderBlocked) }))
  return { ok: true, since, found: fresh.length, alerted, bounces: fresh }
}
