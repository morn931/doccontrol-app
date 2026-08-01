import type { createServiceClient } from '@/lib/supabase/server'

// Go-live cutover (2026-08-01): the two-week parallel run with the old Power
// Apps tool. Operational screens (Incoming Batches, My Reviews, dashboard
// stats) and the reminder engine only show/chase work RECEIVED on or after
// this date — older items are finished in the old system. Nothing is deleted:
// Document Search, MDDR, the registers and the previous-reviewer prefill keep
// the full history, and the lists have a "show older" escape hatch.
// Stored in system_settings key 'coredocs_golive_cutover' (ISO date);
// absent/blank = no filtering.
export async function getGoLiveCutover(db: ReturnType<typeof createServiceClient>): Promise<string | null> {
  const { data } = await db.from('system_settings')
    .select('value').eq('key', 'coredocs_golive_cutover').maybeSingle()
  const v = ((data as any)?.value as string | undefined)?.trim()
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null
}
