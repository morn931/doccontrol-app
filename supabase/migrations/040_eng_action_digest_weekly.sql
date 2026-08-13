-- Per-action weekly digest cadence.
--
-- The Engineering Action digest previously re-sent every open action to its assignee every
-- weekday. Instead, each action should be re-sent to its assignee only ONCE A WEEK: after it's
-- emailed, it waits ~7 days before it can be emailed again. We track the last time each action
-- was emailed to its assignee here; the digest cron stamps this on send and skips actions
-- emailed within the last 7 days.
--
-- Idempotent. Apply in the CoreDocs Supabase project (tjzeahdimbekuizegsky).
alter table engineering_action
  add column if not exists last_digest_emailed_at timestamptz;
