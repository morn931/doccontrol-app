/**
 * GET /api/eng2-libraries
 * Lists the document libraries in the PPE Engineering (ENG2) SharePoint site, so the
 * internal-return interlock can offer the exact discipline libraries a reviewed
 * document can be placed into. Auth-gated. Read-only.
 */
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { listSiteLibraries } from '@/lib/services/graph'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  try {
    const libraries = await listSiteLibraries()
    return NextResponse.json({ libraries })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not list Engineering libraries' }, { status: 502 })
  }
}
