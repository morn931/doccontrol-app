/**
 * Direct SharePoint → Supabase sync. Reads the Approver Picks and Document
 * Approval lists via Microsoft Graph and runs the shared importer. Used by the
 * manual "Sync now" button and the daily cron.
 */
import { readApproverPicks, readApprovalList } from '@/lib/services/sharepoint-lists'
import { processImport, type ImportResult } from './process'

const READERS: Record<string, () => Promise<any[]>> = {
  approver_picks: readApproverPicks,
  document_approval_list: readApprovalList,
}

export async function syncFromSharePoint(
  db: any,
  opts: { mode?: 'full' | 'incremental' | 'dry_run'; sources?: string[] } = {},
): Promise<Record<string, ImportResult & { read: number }>> {
  const mode = opts.mode ?? 'full'
  // Approver Picks first (creates vendors + batches), then the approval list.
  const sources = opts.sources ?? ['approver_picks', 'document_approval_list']
  const out: Record<string, ImportResult & { read: number }> = {}

  for (const source of sources) {
    const reader = READERS[source]
    if (!reader) continue
    const { data: run } = await db.from('import_runs')
      .insert({ source: `${source}:sharepoint`, mode, status: 'running', started_by: null })
      .select().single()
    try {
      const allRows = await reader()
      // Incremental: only process rows changed since the last successful sync watermark.
      const wmKey = `sp_watermark_${source}`
      let rows = allRows
      if (mode === 'incremental') {
        const { data: wm } = await db.from('system_settings').select('value').eq('key', wmKey).maybeSingle()
        const since = wm?.value
        if (since) rows = allRows.filter(r => r.__modified && r.__modified > since)
      }
      const result = await processImport(run?.id, source, mode, rows, db)
      // Advance the watermark to the newest item seen (full read), unless dry run.
      if (mode !== 'dry_run' && result.status !== 'failed') {
        const maxMod = allRows.reduce((m, r) => (r.__modified && r.__modified > m ? r.__modified : m), '')
        if (maxMod) await db.from('system_settings').upsert({ key: wmKey, value: maxMod }, { onConflict: 'key' })
      }
      out[source] = { ...result, read: rows.length }
    } catch (e: any) {
      if (run?.id) await db.from('import_runs').update({
        status: 'failed', completed_at: new Date().toISOString(), error_log: e.message,
      }).eq('id', run.id)
      out[source] = {
        status: 'failed', error_log: e.message, read: 0,
        records_scanned: 0, records_created: 0, records_updated: 0, records_failed: 0,
      }
    }
  }
  return out
}
