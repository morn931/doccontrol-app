-- 027 — "PPE responsible" on the RFI Tracker.
-- Auto-suggested by aconex_rfi_sync.py from the thread's PPE participants;
-- editable in the UI. Once edited, ppe_responsible_manual = true and the sync
-- never overwrites it (clearing the name in the UI flips it back to auto).
-- Idempotent — safe to re-run.

alter table aconex_rfi
  add column if not exists ppe_responsible text,
  add column if not exists ppe_responsible_manual boolean not null default false;
