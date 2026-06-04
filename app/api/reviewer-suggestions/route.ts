import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const packageId  = searchParams.get('packageId')
  const discipline = searchParams.get('discipline')

  const db = createServiceClient()

  // Find reviewers who have reviewed documents for this package/discipline before
  let query = db.from('review_tasks')
    .select('reviewer_email, review_outcome_code, sequence_number, batches!inner(package_id)')
    .not('reviewer_email', 'is', null)
    .eq('status', 'completed')

  if (packageId) query = (query as any).eq('batches.package_id', packageId)

  const { data: tasks } = await query.limit(500)

  // Aggregate by reviewer email
  const reviewerStats = new Map<string, { email: string; count: number; sequences: number[] }>()
  for (const t of (tasks ?? [])) {
    const key = t.reviewer_email
    if (!reviewerStats.has(key)) reviewerStats.set(key, { email: key, count: 0, sequences: [] })
    const s = reviewerStats.get(key)!
    s.count++
    s.sequences.push(t.sequence_number)
  }

  // Sort by review count descending
  const suggestions = [...reviewerStats.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(s => ({
      email:       s.email,
      name:        s.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      reviewCount: s.count,
      typicalSeq:  Math.round(s.sequences.reduce((a, b) => a + b, 0) / s.sequences.length),
    }))

  // Also get all active users with reviewer role
  const { data: users } = await db.from('users')
    .select('id, email, full_name, discipline, role')
    .in('role', ['reviewer','engineering_manager','document_controller','admin'])
    .eq('active', true)
    .order('full_name')

  return NextResponse.json({ suggestions, users: users ?? [] })
}
