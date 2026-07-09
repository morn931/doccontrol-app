'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'

export type LineInput = {
  document_type_code?: string
  discipline_code?: string
  area_code?: string
  title1?: string
  title2?: string
  title3?: string
  revision?: string
  due_date?: string
  comments?: string
}

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('users').select('id, role, email').eq('auth_user_id', user.id).single()
  const perms = await getPermissions(supabase)
  const role = (profile?.role ?? 'reviewer') as string
  return { profile, perms, role }
}

export async function createRequest(input: {
  package_code?: string
  package_id?: string | null
  response_required_by?: string | null
  notes?: string
  lines: LineInput[]
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const c = await ctx()
  if (!c) return { ok: false, error: 'Not signed in' }
  if (!can(c.perms, FK.ACTION_REQUEST_DOC_NUMBER, c.role)) return { ok: false, error: 'Not authorised to request a document number.' }

  const lines = input.lines.filter((l) => l.document_type_code || l.title2 || l.title3)
  if (lines.length === 0) return { ok: false, error: 'Add at least one document line.' }

  const svc = createServiceClient()
  const year = new Date().getFullYear()
  const { count } = await svc.from('document_number_request').select('id', { count: 'exact', head: true })
  const request_no = `DNR-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data: hdr, error } = await svc.from('document_number_request').insert({
    request_no,
    requestor_user_id: c.profile?.id ?? null,
    requestor_email: c.profile?.email ?? null,
    package_code: input.package_code || null,
    package_id: input.package_id || null,
    response_required_by: input.response_required_by || null,
    notes: input.notes || null,
    status: 'submitted',
  }).select('id').single()
  if (error || !hdr) return { ok: false, error: error?.message ?? 'Could not create request' }

  const rows = lines.map((l, i) => ({
    request_id: hdr.id,
    line_no: i + 1,
    document_type_code: l.document_type_code || null,
    discipline_code: l.discipline_code || null,
    area_code: l.area_code || null,
    title1: l.title1 || null,
    title2: l.title2 || null,
    title3: l.title3 || null,
    revision: l.revision || 'A',
    due_date: l.due_date || null,
    comments: l.comments || null,
  }))
  const { error: le } = await svc.from('document_number_request_line').insert(rows)
  if (le) return { ok: false, error: le.message }

  revalidatePath('/documents/requests')
  return { ok: true, id: hdr.id }
}

export async function allocateLine(lineId: string, patch: {
  rdmc_document_number?: string
  ppe_doc_number?: string
  full_title?: string
  sequential_no?: string
}): Promise<{ ok: boolean; error?: string }> {
  const c = await ctx()
  if (!c) return { ok: false, error: 'Not signed in' }
  if (!can(c.perms, FK.ACTION_ASSIGN_DOC_NUMBER, c.role)) return { ok: false, error: 'Only Document Control can allocate a number.' }

  const svc = createServiceClient()
  const rdmc = patch.rdmc_document_number?.trim() || null

  const { data: line, error: e0 } = await svc
    .from('document_number_request_line')
    .select('id, request_id')
    .eq('id', lineId).single()
  if (e0 || !line) return { ok: false, error: 'Line not found' }

  const { error } = await svc.from('document_number_request_line').update({
    rdmc_document_number: rdmc,
    ppe_doc_number: patch.ppe_doc_number?.trim() || null,
    full_title: patch.full_title?.trim() || null,
    sequential_no: patch.sequential_no?.trim() || null,
    line_status: rdmc ? 'assigned' : 'pending',
    assigned_by: rdmc ? c.profile?.id ?? null : null,
    assigned_at: rdmc ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', lineId)
  if (error) return { ok: false, error: error.message }

  // Roll the request status up: assigned once every line has a number.
  const { data: lines } = await svc.from('document_number_request_line')
    .select('line_status').eq('request_id', line.request_id)
  const all = (lines ?? []) as { line_status: string }[]
  const status = all.length && all.every((l) => l.line_status === 'assigned') ? 'assigned'
    : all.some((l) => l.line_status === 'assigned') ? 'in_progress' : 'submitted'
  await svc.from('document_number_request').update({ status, updated_at: new Date().toISOString() }).eq('id', line.request_id)

  revalidatePath(`/documents/requests/${line.request_id}`)
  revalidatePath('/documents/requests')
  return { ok: true }
}

export async function deleteRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  const c = await ctx()
  if (!c) return { ok: false, error: 'Not signed in' }
  if (!can(c.perms, FK.ACTION_ASSIGN_DOC_NUMBER, c.role)) return { ok: false, error: 'Not authorised' }
  const svc = createServiceClient()
  const { error } = await svc.from('document_number_request').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/documents/requests')
  return { ok: true }
}
