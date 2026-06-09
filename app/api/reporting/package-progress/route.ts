import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { aggregatePackages } from '@/lib/reporting/package-progress'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const db: any = createServiceClient()
  const url = new URL(req.url)
  const periodEnd = url.searchParams.get('periodEnd') || new Date().toISOString().slice(0, 10)

  try {
    const { rows, total } = await aggregatePackages(db, periodEnd)
    return NextResponse.json({ rows, total, periodEnd, generatedAt: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
