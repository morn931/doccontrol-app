import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runMailBounceCheck } from '@/lib/mail-bounce-check'

export const dynamic = 'force-dynamic'

// Hourly (vercel.json, 10 past the hour): read the projects@coreflow.build Inbox for
// postmaster NDRs and alert Morné from the PPE tenant if any are new. The reason it
// exists is written at the top of lib/mail-bounce-check.ts.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? req.nextUrl.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const result = await runMailBounceCheck(createServiceClient())
  return NextResponse.json(result, { status: result.ok ? 200 : 503 })
}
