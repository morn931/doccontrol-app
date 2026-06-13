import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { aggregateByActivity } from '@/lib/reporting/p6-export'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const db: any = createServiceClient()
  const pkg = new URL(req.url).searchParams.get('package') || undefined
  try {
    const { rows, total } = await aggregateByActivity(db, { package: pkg })
    return NextResponse.json({ rows, total, generatedAt: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
