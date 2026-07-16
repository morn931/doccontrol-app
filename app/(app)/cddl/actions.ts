'use server'

// CDDL in-app management (migration 017). Editing is allowed only for
// Document Control roles, only for the manually-managed fields, and only when
// the register is in 'coreflow_master' mode (while the Excel workbook is
// master, the daily full-replace would clobber in-app edits). Every change is
// audit-logged to cddl_edit_log.

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const EDIT_ROLES = new Set(['admin', 'document_controller', 'developer'])

// The fields Document Control manages by hand (the Aconex-owned columns —
// doc/review status, revision, % ladder — are refreshed by the daily sync).
const EDITABLE = new Set([
  'ppe_docno', 'doc_owner_initials', 'due', 'schedule_status', 'activity_id',
  'main_group', 'sub_group', 'bh', 'drawing_pack', 'comments',
  'rev_a_transmittal', 'rev0_transmittal', 'title', 'discipline', 'wbs',
])

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  return { role: (profile?.role ?? 'reviewer') as string, email: profile?.email ?? user.email ?? '' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMode(svc: any): Promise<string> {
  const { data } = await svc.from('cddl_settings').select('value').eq('key', 'mode').maybeSingle()
  return data?.value ?? 'excel_master'
}

export async function getCddlMode(): Promise<string> {
  return getMode(createServiceClient())
}

type Result = { ok: true } | { ok: false; error: string }

export async function updateCddlDoc(docno: string, changes: Record<string, string | null>): Promise<Result> {
  const c = await ctx()
  if (!c || !EDIT_ROLES.has(c.role)) return { ok: false, error: 'Only Document Control can edit the CDDL.' }
  const svc = createServiceClient()
  if ((await getMode(svc)) !== 'coreflow_master')
    return { ok: false, error: 'The Excel workbook is still master — switch the register to Coreflow-managed first.' }

  const fields = Object.fromEntries(Object.entries(changes).filter(([k]) => EDITABLE.has(k)))
  if (!Object.keys(fields).length) return { ok: false, error: 'Nothing editable in the change set.' }

  const { data: before } = await svc.from('cddl_doc').select('*').eq('docno', docno).maybeSingle()
  if (!before) return { ok: false, error: `Document ${docno} not found.` }

  const { error } = await svc.from('cddl_doc').update(fields).eq('docno', docno)
  if (error) return { ok: false, error: error.message }

  const log = Object.entries(fields).map(([field, v]) => ({
    docno, field,
    old_value: before[field] == null ? null : String(before[field]),
    new_value: v == null ? null : String(v),
    edited_by: c.email,
  }))
  await svc.from('cddl_edit_log').insert(log)
  revalidatePath('/cddl')
  return { ok: true }
}

export async function addCddlDoc(row: Record<string, string | null>): Promise<Result> {
  const c = await ctx()
  if (!c || !EDIT_ROLES.has(c.role)) return { ok: false, error: 'Only Document Control can edit the CDDL.' }
  const svc = createServiceClient()
  if ((await getMode(svc)) !== 'coreflow_master')
    return { ok: false, error: 'The Excel workbook is still master — switch the register to Coreflow-managed first.' }
  const docno = (row.docno ?? '').trim()
  if (!docno) return { ok: false, error: 'Document number is required.' }

  const fields: Record<string, string | null> = { package_code: row.package_code ?? 'K124', docno }
  for (const [k, v] of Object.entries(row)) if (EDITABLE.has(k)) fields[k] = v
  fields.aconex_doc_status = 'RES - Reserved Placeholder'
  fields.aconex_review_status = 'Pending'

  const { error } = await svc.from('cddl_doc').insert(fields)
  if (error) return { ok: false, error: error.message.includes('duplicate') ? `${docno} already exists.` : error.message }
  await svc.from('cddl_edit_log').insert([{ docno, field: '(created)', old_value: null, new_value: 'new placeholder', edited_by: c.email }])
  revalidatePath('/cddl')
  return { ok: true }
}

export async function retireCddlDoc(docno: string, retired: boolean): Promise<Result> {
  const c = await ctx()
  if (!c || !EDIT_ROLES.has(c.role)) return { ok: false, error: 'Only Document Control can edit the CDDL.' }
  const svc = createServiceClient()
  if ((await getMode(svc)) !== 'coreflow_master')
    return { ok: false, error: 'The Excel workbook is still master — switch the register to Coreflow-managed first.' }
  const { error } = await svc.from('cddl_doc').update({ retired }).eq('docno', docno)
  if (error) return { ok: false, error: error.message }
  await svc.from('cddl_edit_log').insert([{ docno, field: 'retired', old_value: String(!retired), new_value: String(retired), edited_by: c.email }])
  revalidatePath('/cddl')
  return { ok: true }
}

// The cut-over switch (both directions, admin/doc-control only, audit-logged).
export async function setCddlMode(mode: 'excel_master' | 'coreflow_master'): Promise<Result> {
  const c = await ctx()
  if (!c || !EDIT_ROLES.has(c.role)) return { ok: false, error: 'Only Document Control can switch the CDDL mode.' }
  const svc = createServiceClient()
  const prev = await getMode(svc)
  const { error } = await svc.from('cddl_settings')
    .upsert({ key: 'mode', value: mode, updated_by: c.email, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: error.message }
  await svc.from('cddl_edit_log').insert([{ docno: '(register)', field: 'mode', old_value: prev, new_value: mode, edited_by: c.email }])
  revalidatePath('/cddl')
  return { ok: true }
}
