/**
 * Prelim Review — shared pieces (migration 051).
 *
 * The group pass in front of the formal chain: a session pulls drawings from a source
 * folder (the K138 COLAB library by default), copies each into the Internal Reviews
 * library under Prelim/<session>/, the room marks them up together, records an outcome
 * per drawing, and "hand over" creates the formal batch through the existing internal
 * front doors. Nothing touches `batches` before hand-over.
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { parseDocumentFileName } from '@/lib/utils/document-number-parser'

export const PRELIM_SOURCE_SITE_URL = process.env.PRELIM_SOURCE_SITE_URL
  || 'https://ppetechcoza.sharepoint.com/sites/K138-BalanceofPlant'
export const PRELIM_SOURCE_LIBRARY  = process.env.PRELIM_SOURCE_LIBRARY || 'COLAB'
/** Folder inside the Internal Reviews library that holds the working copies. */
export const PRELIM_FOLDER = process.env.PRELIM_FOLDER || 'Prelim'

export type PrelimAuth = {
  userId: string
  email: string
  name: string | null
  role: string
  canManage: boolean
}

/** Auth + permission gate for every prelim route. `need` = 'view' (nav key) or 'manage'. */
export async function prelimAuth(need: 'view' | 'manage'): Promise<PrelimAuth | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('id, role, email, full_name').eq('auth_user_id', user.id).single()
  const role = String(profile?.role ?? 'reviewer')
  const perms = await getPermissions(supabase)
  const canView = can(perms, FK.NAV_PRELIM_REVIEW, role)
  const canManage = can(perms, FK.ACTION_PRELIM_MANAGE, role)
  if (!canView) return NextResponse.json({ error: 'Not authorised for Prelim Review.' }, { status: 403 })
  if (need === 'manage' && !canManage) return NextResponse.json({ error: 'Not authorised to manage a prelim session.' }, { status: 403 })
  return { userId: String(profile?.id ?? user.id), email: profile?.email ?? user.email ?? '', name: profile?.full_name ?? null, role, canManage }
}

export const isErr = (a: PrelimAuth | NextResponse): a is NextResponse => a instanceof NextResponse

/** A filesystem-safe folder name for a session's working copies. */
export const sessionFolder = (title: string, id: string) =>
  `${PRELIM_FOLDER}/${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)} ${id.slice(0, 8)}`

/** The drawing office address the "To drawing office" button mails. Env wins, then the
 *  system_settings row, then the standing default (Miemie Vorster). */
export async function drawingOfficeEmail(): Promise<string> {
  if (process.env.PRELIM_DRAWING_OFFICE_EMAIL) return process.env.PRELIM_DRAWING_OFFICE_EMAIL
  const db = createServiceClient()
  const { data } = await db.from('system_settings').select('value').eq('key', 'prelim_drawing_office_email').maybeSingle()
  const v = String((data as any)?.value ?? '').trim()
  return v.includes('@') ? v : 'miemiev@ppetech.co.za'
}

/** The Document Control address the "To Document Control" button mails. Env, then the
 *  system_settings row, then Bernice Neethling. */
export async function documentControlEmail(): Promise<string> {
  if (process.env.PRELIM_DOCUMENT_CONTROL_EMAIL) return process.env.PRELIM_DOCUMENT_CONTROL_EMAIL
  const db = createServiceClient()
  const { data } = await db.from('system_settings').select('value').eq('key', 'prelim_document_control_email').maybeSingle()
  const v = String((data as any)?.value ?? '').trim()
  return v.includes('@') ? v : 'bernicen@ppetech.co.za'
}

export type { Person } from './prelim/lead'
export { resolveLead } from './prelim/lead'
import type { Person } from './prelim/lead'

/** Every active CoreDocs user — the picker the reviewer chooses a lead from. */
export async function listPeople(): Promise<Person[]> {
  const db = createServiceClient()
  const { data } = await db.from('users').select('email, full_name, role, active').limit(1000)
  return ((data ?? []) as any[])
    .filter(u => u.active !== false && u.email)
    .map(u => ({ email: String(u.email).toLowerCase(), name: String(u.full_name ?? u.email), role: String(u.role ?? '') }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Match a pulled file to the CDDL by the number in its filename. Exact on the RDMC
 *  number, then on the PPE number; nothing is guessed from the title. */
export async function matchCddl(fileName: string) {
  const parsed = parseDocumentFileName(fileName)
  const no = parsed.normalizedDocumentNumber?.trim()
  const out = { parsed, cddl: null as null | { id: string; docno: string; title: string | null; discipline: string | null; doc_type: string | null; revision: string | null } }
  if (!no || !/^[A-Z0-9]{4,}-?/i.test(no)) return out
  const db = createServiceClient()
  const sel = 'id, docno, title, discipline, doc_type, revision'
  const { data: byRdmc } = await db.from('cddl_doc').select(sel).ilike('docno', no).limit(1).maybeSingle()
  if (byRdmc) { out.cddl = byRdmc as any; return out }
  const { data: byPpe } = await db.from('cddl_doc').select(sel).ilike('ppe_docno', no).limit(1).maybeSingle()
  if (byPpe) out.cddl = byPpe as any
  return out
}
