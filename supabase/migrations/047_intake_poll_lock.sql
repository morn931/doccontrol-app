-- ============================================================================
-- 047_intake_poll_lock.sql · Per-vendor-site lock for the intake poller
-- Root cause of split/duplicate intake batches (2026-08-21): the `intake-poll`
-- Vercel cron fires every minute (vercel.json), but a single poll of one vendor
-- can take well over a minute (Graph copy + AI review per file). With no lock,
-- an overlapping cron tick re-polls the same drop-off library, both ticks see
-- the same not-yet-ledgered files as "fresh", and both create their own batch
-- for the same physical documents — fragmenting one vendor drop into 2-3
-- batches, each emailing the controller its own (correct at the time, but
-- incomplete) "N documents received" count.
--
-- Adds a simple compare-and-swap lock column on vendor_sites: a poll run only
-- proceeds if it can atomically claim polling_started_at (NULL or stale by
-- more than 5 minutes, as a crash/timeout safety valve — cron maxDuration is
-- 300s). Released (set back to NULL) when the run finishes, success or error.
-- Idempotent — safe to re-run.
-- ============================================================================

alter table vendor_sites add column if not exists polling_started_at timestamptz;
