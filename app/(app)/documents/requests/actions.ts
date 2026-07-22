'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { sendMail, brandedEmail } from '@/lib/coreflow-mail'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://docs.coreflow.build'
const CONTROLLER_KEY = 'doc_request_controller_email'
const DEFAULT_CONTROLLER = 'mornec@ppetech.co.za'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function controllerEmailFrom(svc: any): Promise<string> {
  const { data } = await svc.from('system_settings').select('value').eq('key', CONTROLLER_KEY).maybeSingle()
  const v = (data?.value ?? '').trim()
  return v || DEFAULT_CONTROLLER
}

/** The email that new document-number requests are sent to (Developer Tools setting). */
export async function getControllerEmail(): Promise<string> {
  return controllerEmailFrom(createServiceClient())
}

export async function setControllerEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const c = await ctx()
  if (!c) return { ok: false, error: 'Not signed in' }
  if (c.role !== 'developer' && c.role !== 'admin') return { ok: false, error: 'Developers only.' }
  const svc = createServiceClient()
  const { error } = await svc.from('system_settings')
    .upsert({ key: CONTROLLER_KEY, value: email.trim(), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/developer/doc-requests')
  return { ok: true }
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

  // Notify the Document Controller (best-effort — never fail the request on email).
  try {
    const to = await controllerEmailFrom(svc)
    await sendMail({
      to,
      subject: `New document number request ${request_no}`,
      htmlBody: brandedEmail({
        heading: `New document number request — ${request_no}`,
        bodyHtml: `<p>A new document number request has been submitted and is waiting for you to allocate the RDMC numbers.</p>
          <p style="margin:12px 0"><b>Requestor:</b> ${c.profile?.email ?? '—'}<br/>
          <b>Package:</b> ${input.package_code ?? '—'}<br/>
          <b>Documents to number:</b> ${rows.length}</p>`,
        cta: { href: `${APP_URL}/documents/requests/${hdr.id}`, label: 'Open request to allocate →' },
      }),
    })
  } catch {}

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

  // When every line is allocated, let the requestor know their numbers are ready.
  if (status === 'assigned') {
    try {
      const { data: req } = await svc.from('document_number_request').select('request_no, requestor_email').eq('id', line.request_id).single()
      if (req?.requestor_email) {
        const { data: allLines } = await svc.from('document_number_request_line')
          .select('rdmc_document_number, full_title').eq('request_id', line.request_id).order('line_no')
        const listHtml = ((allLines ?? []) as { rdmc_document_number: string | null; full_title: string | null }[])
          .map((l) => `<li><b>${l.rdmc_document_number ?? '—'}</b>${l.full_title ? ` — ${l.full_title}` : ''}</li>`).join('')
        await sendMail({
          to: req.requestor_email,
          subject: `Document numbers allocated ${req.request_no ?? ''}`,
          htmlBody: brandedEmail({
            heading: 'Your document numbers are allocated',
            bodyHtml: `<p>Document Control has allocated the numbers for your request <b>${req.request_no ?? ''}</b>:</p><ul style="padding-left:18px;color:#374151">${listHtml}</ul>`,
            cta: { href: `${APP_URL}/documents/requests/${line.request_id}`, label: 'View request →' },
          }),
        })
      }
    } catch {}
  }

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

// ─── Drawing Number Picker — pre-check for an existing (placeholder) number ───
// A placeholder = an Aconex Review Tracker row whose court is 'NOT_TRANSMITTED'
// ("not yet submitted — PPE"), owned by FV / MC / VV or blank, and not already booked.
export type Placeholder = {
  docno: string; title: string | null; discipline: string | null; doc_type: string | null; package_code: string | null; wbs: string | null
}
// WBS/area is the CCCC segment of the RDMC number: 6105AK124-<6186>-EDBD-0001
const wbsOf = (docno: string): string | null => docno?.split('-')?.[1] ?? null
const PLACEHOLDER_OWNER_INITIALS = ['FV', 'MC', 'VV', 'JV2'] // Flippie, Morne, Vossie (VV / JV2)

export async function getAvailablePlaceholders(): Promise<Placeholder[]> {
  const c = await ctx()
  if (!c) return []
  const svc = createServiceClient()

  // Page through with KEYSET pagination (docno > last) — PostgREST caps responses at
  // max_rows (1000), and there are thousands of NOT_TRANSMITTED rows (Vossie alone owns
  // ~4k). Keyset (not .range()) gives every page a distinct URL so Next.js's fetch cache
  // can't hand back page 1 for every page.
  const rows: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  let last = ''
  for (let guard = 0; guard < 200; guard++) {
    const { data, error } = await svc.from('aconex_review_doc')
      .select('docno, title, discipline, doc_type, doc_owner, package_code')
      .eq('court', 'NOT_TRANSMITTED')
      .gt('docno', last)
      .order('docno', { ascending: true })
      .limit(1000)
    if (error || !data || data.length === 0) break
    rows.push(...data)
    last = data[data.length - 1].docno
    if (data.length < 1000) break
  }

  const ownerOk = (o: string | null) => {
    const s = (o ?? '').trim()
    if (!s) return true // blank owner counts
    const up = s.toUpperCase()
    // Match "Flippie van Vuuren (FV)" (bracketed) OR a raw unmapped "FV" — never a bare
    // substring, so "McAllister" is not caught by MC.
    return PLACEHOLDER_OWNER_INITIALS.some((i) => up === i || up.includes(`(${i})`))
  }
  const placeholders = rows.filter((r) => ownerOk(r.doc_owner))

  // Exclude anything already booked (table may not exist until migration 022 — treat as none).
  let booked = new Set<string>()
  const { data: b, error: be } = await svc.from('doc_number_booking').select('docno').eq('released', false)
  if (!be) booked = new Set((b ?? []).map((x: any) => x.docno)) // eslint-disable-line @typescript-eslint/no-explicit-any

  return placeholders
    .filter((r) => !booked.has(r.docno))
    .map((r) => ({ docno: r.docno, title: r.title, discipline: r.discipline, doc_type: r.doc_type, package_code: r.package_code, wbs: wbsOf(r.docno) }))
    .sort((a, b2) => a.docno.localeCompare(b2.docno))
}

export async function bookPlaceholder(docno: string): Promise<{ ok: boolean; error?: string; requestId?: string }> {
  const c = await ctx()
  if (!c) return { ok: false, error: 'Not signed in' }
  if (!can(c.perms, FK.ACTION_REQUEST_DOC_NUMBER, c.role)) return { ok: false, error: 'Not authorised to book a number.' }
  const svc = createServiceClient()

  // Already booked? (the unique index also enforces this, but check for a clean message)
  const { data: existing } = await svc.from('doc_number_booking')
    .select('id').eq('docno', docno).eq('released', false).maybeSingle()
  if (existing) return { ok: false, error: 'That number was just booked by someone else — refresh the list.' }

  const { data: ph } = await svc.from('aconex_review_doc')
    .select('docno, title, discipline, doc_type, package_code, revision').eq('docno', docno).limit(1).maybeSingle()
  if (!ph) return { ok: false, error: 'Placeholder not found.' }

  // Create an already-"assigned" Document Request pre-filled with the existing number,
  // so it drops straight into the normal upload flow (same as a Doc-Control allocation).
  const year = new Date().getFullYear()
  const { count } = await svc.from('document_number_request').select('id', { count: 'exact', head: true })
  const request_no = `DNR-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`
  const { data: hdr, error: he } = await svc.from('document_number_request').insert({
    request_no,
    requestor_user_id: c.profile?.id ?? null,
    requestor_email: c.profile?.email ?? null,
    package_code: ph.package_code ?? null,
    status: 'assigned',
    notes: 'Booked from an existing placeholder number via the Number Picker.',
  }).select('id').single()
  if (he || !hdr) return { ok: false, error: he?.message ?? 'Could not create request' }

  const { data: line, error: le } = await svc.from('document_number_request_line').insert({
    request_id: hdr.id,
    line_no: 1,
    discipline_code: ph.discipline ?? null,
    document_type_code: ph.doc_type ?? null,
    title2: ph.title ?? null,
    revision: ph.revision || 'A',
    rdmc_document_number: ph.docno,
    full_title: ph.title ?? null,
    line_status: 'assigned',
    assigned_by: c.profile?.id ?? null,
    assigned_at: new Date().toISOString(),
  }).select('id').single()
  if (le || !line) return { ok: false, error: le?.message ?? 'Could not create request line' }

  const { error: bkErr } = await svc.from('doc_number_booking').insert({
    docno: ph.docno, package_code: ph.package_code ?? null, title: ph.title ?? null, discipline: ph.discipline ?? null,
    booked_by: c.profile?.id ?? null, booked_by_email: c.profile?.email ?? null,
    request_id: hdr.id, request_line_id: line.id,
  })
  if (bkErr) return { ok: false, error: `Could not record the booking: ${bkErr.message}` }

  revalidatePath('/documents/requests')
  return { ok: true, requestId: hdr.id }
}
