/**
 * Missing-migration alert for the intake poller.
 *
 * The 2026-08-21 → 08-24 outage: migration 047 (the poll-lock column) was committed with the code
 * but never applied in Supabase, so every poll run errored on the missing column and silently
 * ingested nothing for three days. This turns that into a same-morning heads-up: if a poll run hits
 * a database SCHEMA error (a committed-but-unapplied migration almost always looks like a
 * missing column/table), email the developers — throttled so the every-minute cron can't spam,
 * and re-armed automatically once intake recovers.
 */
import { sendEmail } from '@/lib/services/graph'

const ALERT_KEY = 'intake_schema_alert_at'
const THROTTLE_MS = 6 * 60 * 60 * 1000 // at most one alert per 6h while unresolved
const FALLBACK_TO = 'mornec@ppetech.co.za,liezlc@ppetech.co.za'

// Postgres / PostgREST signatures of a schema mismatch (missing column or table = missing migration).
const SCHEMA_ERR = /schema cache|does not exist|Could not find the .*(column|table)|PGRST20[0-9]|\b42703\b|\b42P01\b/i

function esc(s: string): string {
  return String(s ?? '').replace(/[<>&]/g, ' ')
}

/**
 * Inspect a poll run's collected errors. On a schema error, send a throttled alert; on a clean run,
 * clear the throttle so the next distinct issue alerts immediately. Never throws.
 */
export async function handleSchemaAlert(db: any, errors: string[]): Promise<void> {
  try {
    const hits = (errors ?? []).filter((e) => SCHEMA_ERR.test(e))
    if (!hits.length) {
      // Healthy run — re-arm the alert (idempotent; no-op if nothing was stored).
      await db.from('system_settings').delete().eq('key', ALERT_KEY)
      return
    }

    const { data: last } = await db.from('system_settings').select('value').eq('key', ALERT_KEY).maybeSingle()
    const lastAt = last?.value ? Date.parse(last.value) : 0
    if (Date.now() - lastAt < THROTTLE_MS) return // already alerted recently

    const { data: cfg } = await db.from('system_settings').select('value').eq('key', 'dev_alert_email').maybeSingle()
    const to = String(cfg?.value || FALLBACK_TO).split(/[;,]/).map((s) => s.trim()).filter(Boolean)

    await sendEmail({
      to,
      subject: '⚠ CoreDocs intake stalled — a database migration is probably missing',
      htmlBody: `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">
        <p>The vendor-intake poller is failing on a <b>database schema error</b> — this almost always means a
        migration was committed to <code>supabase/migrations/</code> but never applied in the Supabase SQL Editor.
        <b style="color:#b02a2a">Vendor documents are not being ingested until it's applied.</b></p>
        <p style="margin:12px 0"><b>Sample error</b> (${hits.length} vendor site(s) affected):<br>
          <code style="color:#b02a2a">${esc(hits[0]).slice(0, 300)}</code></p>
        <p><b>Fix:</b> apply the newest file(s) under <code>supabase/migrations/</code> in Supabase
          (project <code>tjzeahdimbekuizegsky</code>). Intake resumes on the next cron tick.</p>
        <p style="color:#6b7280;font-size:12px;margin-top:14px">Throttled: you won't get another of these for 6 hours,
          and it re-arms automatically once intake recovers. — CoreDocs intake monitor</p>
      </div>`,
    })

    await db.from('system_settings').upsert(
      { key: ALERT_KEY, value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  } catch (e) {
    console.error('schema-alert failed:', e) // monitoring must never break the poll
  }
}
