-- 042_new_intake_pipeline.sql
-- In-app vendor document intake — replaces the Power Automate per-vendor "small flows"
-- (E101…K137 watchers) + la-intake-core, rolled out ONE vendor at a time behind a flag so
-- the old flow keeps running untouched until each vendor is flipped over. Idempotent.

-- Per-vendor enablement: only vendors with this ON are polled by the in-app intake.
-- Everything else stays on Power Automate. Start with ICTS = true for the pilot.
alter table vendor_sites add column if not exists new_intake_enabled boolean not null default false;

-- The DocumentControl package bucket the poller copies incoming files INTO (what the small
-- flow's `return.libraryPath` provided). e.g. 'K137  220kV  33kV Overhead Lines 2'.
-- Nullable: if unset the poller still creates the batch + runs the AI review, but skips the copy.
alter table vendor_sites add column if not exists documentcontrol_library text;

-- Ingest ledger — never ingest the same dropped file twice (keyed on the SharePoint driveItem id).
create table if not exists intake_ingest_ledger (
  id            uuid primary key default gen_random_uuid(),
  package_code  text not null,
  drive_item_id text not null,
  file_name     text,
  etag          text,
  batch_id      uuid,
  ingested_at   timestamptz not null default now()
);
create unique index if not exists uq_ingest_ledger_item on intake_ingest_ledger (drive_item_id);
create index if not exists idx_ingest_ledger_pkg on intake_ingest_ledger (package_code, ingested_at desc);
alter table intake_ingest_ledger enable row level security;

-- Store the pre-review AI result (extracted fields + the ✅/❌ SDDR check report) on each
-- document version, so the controller notification + the batch page can render it.
alter table document_versions add column if not exists ai_review jsonb;
