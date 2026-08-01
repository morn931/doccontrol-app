import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getDeveloperSession } from '@/lib/developer-access'

export async function GET() {
  const session = await getDeveloperSession()
  if (!session) return NextResponse.json({ error: 'Developer role required' }, { status: 403 })
  const db = createServiceClient()
  const { data } = await db
    .from('role_definitions')
    .select('role, label')
    .eq('active', true)
    .order('sort_order')
  return NextResponse.json(data ?? [])
}
