'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type RfiRecipient = { name: string; org: string; type: string; status: string }
export type RfiAttachment = {
  kind: string
  attachment_id?: string | null
  FileName?: string
  FileSize?: string
}
export type RfiMail = {
  id: string
  mail_id: number
  thread_id: number | null
  mail_no: string | null
  in_ref_mail_id: number | null
  box: string | null
  corr_type: string | null
  subject: string | null
  status: string | null
  sent_date: string | null
  from_org: string | null
  from_user: string | null
  recipients: RfiRecipient[] | null
  form_fields: Record<string, string> | null
  attachments: RfiAttachment[] | null
  body_html: string | null
}

/** Set / clear the "PPE responsible" person on an RFI. A non-empty name marks
 *  the row manual (the daily sync will never overwrite it); clearing the name
 *  returns the row to auto-suggestion on the next sync. */
export async function updateRfiResponsible(
  rfiId: string,
  name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const trimmed = name.trim()
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('aconex_rfi')
      .update({ ppe_responsible: trimmed || null, ppe_responsible_manual: trimmed.length > 0 })
      .eq('id', rfiId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/rfi')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** All cached Aconex mail for one RFI thread, oldest first. */
export async function getRfiThread(
  rfiId: string
): Promise<{ ok: true; mails: RfiMail[] } | { ok: false; error: string }> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('aconex_rfi_mail')
      .select(
        'id, mail_id, thread_id, mail_no, in_ref_mail_id, box, corr_type, subject, status, sent_date, from_org, from_user, recipients, form_fields, attachments, body_html'
      )
      .eq('rfi_id', rfiId)
      .order('sent_date', { ascending: true })
      .limit(500)
    if (error) return { ok: false, error: error.message }
    return { ok: true, mails: (data ?? []) as unknown as RfiMail[] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
