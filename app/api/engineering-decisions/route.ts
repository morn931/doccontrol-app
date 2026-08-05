import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET — the whole EDR (any engineer can view).
export async function GET(_req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const db = createServiceClient()
  const { data } = await db.from('engineering_decision').select('*').order('created_at', { ascending: false }).limit(2000)
  return NextResponse.json({ decisions: data ?? [] })
}

// POST — raise a decision. From a "Push to EDR" action: pass { sourceActionId, ...prefilled }.
// Manual: same fields, no sourceActionId. Always enters as pending_approval.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const b = await req.json().catch(() => ({} as any))
  if (!String(b.title ?? '').trim() && !String(b.background ?? '').trim())
    return NextResponse.json({ error: 'A title or background is required.' }, { status: 400 })

  const db = createServiceClient()
  const { data: profile } = await db.from('users').select('email, full_name').eq('auth_user_id', user.id).single()
  const owner = (b.ownerEmail && b.ownerEmail !== '') ? b.ownerEmail : null
  const ownerUser = owner ? (await db.from('users').select('full_name').eq('email', owner).maybeSingle()).data : null

  const row = {
    source_action_id: b.sourceActionId ?? null,
    discipline: b.discipline ?? null, area_system: b.areaSystem ?? null, document_number: b.documentNumber ?? null,
    title: b.title ?? null, background: b.background ?? null,
    options_considered: b.optionsConsidered ?? null, decision_made: b.decisionMade ?? null, rationale: b.rationale ?? null,
    cost_impact: pick(b.costImpact), schedule_impact: pick(b.scheduleImpact), safety_impact: pick(b.safetyImpact),
    priority: ['low', 'medium', 'high', 'critical'].includes(b.priority) ? b.priority : null,
    raised_by_email: (profile as any)?.email ?? user.email ?? '', raised_by_name: (profile as any)?.full_name ?? null,
    owner_email: owner, owner_name: (ownerUser as any)?.full_name ?? b.ownerName ?? null,
    due_date: b.dueDate || null, related_documents: b.relatedDocuments ?? null, comments: b.comments ?? null,
    status: 'pending_approval',
  }
  const { data: created, error } = await db.from('engineering_decision').insert(row).select('id, decision_ref').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: (created as any).id, decision_ref: (created as any).decision_ref }, { status: 201 })
}

function pick(v: any) { return ['none', 'low', 'medium', 'high'].includes(v) ? v : null }
