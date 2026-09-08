// Prelim Review mail — sent from a PPE mailbox through the PPE tenant app (Mail.Send), NOT
// from projects@coreflow.build. Morné, 8 Sep 2026: every prelim email sent from projects@
// after ~16:00 was accepted by Graph and never arrived (Bennie, Bernice, Morné himself) while
// a plain test from mornec@ through the PPE app landed at once. Internal mail, PPE to PPE,
// meets no external-sender filter. Prelim only for now; the rest of CoreDocs stays on
// lib/coreflow-mail.ts. Same branded body, same attachment shape, same subject prefix.
import { getGraphToken } from '@/lib/services/graph'
import { brandedEmail, withModulePrefix, type MailAttachment } from '@/lib/coreflow-mail'
import { COREFLOW_LOGO_B64, PPE_LOGO_B64, HERO_SLATE_B64 } from '@/lib/coreflow-mail-logo'

export { brandedEmail }
export const PRELIM_MAIL_FROM = process.env.PRELIM_MAIL_FROM || 'mornec@ppetech.co.za'

export async function sendPrelimMail(p: { to: string | string[]; cc?: string | string[]; subject: string; htmlBody: string; attachments?: MailAttachment[] }): Promise<void> {
  const toList = (Array.isArray(p.to) ? p.to : [p.to]).filter(Boolean)
  const ccList = (p.cc ? (Array.isArray(p.cc) ? p.cc : [p.cc]) : []).filter(Boolean).filter(e => !toList.includes(e))
  if (!toList.length) return
  const attachments: Record<string, unknown>[] = (p.attachments ?? []).map(a => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType, contentBytes: a.contentBytes }))
  const inline = (cid: string, name: string, bytes: string) => attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name, contentType: 'image/png', contentId: cid, isInline: true, contentBytes: bytes })
  if (p.htmlBody.includes('cid:coreflowlogo')) inline('coreflowlogo', 'coreflow-logo.png', COREFLOW_LOGO_B64)
  if (p.htmlBody.includes('cid:ppelogo')) inline('ppelogo', 'ppe-logo.png', PPE_LOGO_B64)
  if (p.htmlBody.includes('cid:coreflowhero')) inline('coreflowhero', 'coreflow-hero.png', HERO_SLATE_B64)
  const message: Record<string, unknown> = {
    subject: withModulePrefix(p.subject),
    body: { contentType: 'HTML', content: p.htmlBody },
    toRecipients: toList.map(e => ({ emailAddress: { address: e } })),
    ccRecipients: ccList.map(e => ({ emailAddress: { address: e } })),
    ...(attachments.length ? { attachments } : {}),
  }
  const token = await getGraphToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(PRELIM_MAIL_FROM)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  })
  if (!res.ok && res.status !== 202) throw new Error(`sendMail (PPE tenant, as ${PRELIM_MAIL_FROM}): ${res.status} ${await res.text()}`)
}
