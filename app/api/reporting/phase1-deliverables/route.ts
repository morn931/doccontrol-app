import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { aggregatePhase1Wbs } from '@/lib/reporting/phase1-wbs'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET() {
  const db: any = createServiceClient()
  try {
    const { rows, total } = await aggregatePhase1Wbs(db)
    return NextResponse.json({ rows, total, generatedAt: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
