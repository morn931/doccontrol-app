-- 041_signoff_movable_signatures.sql
-- Movable sign-off signatures: store a clean base PDF per batch + each signature's placement,
-- so the signed PDF is REBUILT from the base (non-destructive) and a signer can reposition
-- their signature afterwards. Idempotent.
alter table public.batches
  add column if not exists signoff_base_url text;

alter table public.signoff_tasks
  add column if not exists place_page int,       -- 1-based page the signature sits on
  add column if not exists place_x real,         -- box origin X (PDF points, bottom-left origin)
  add column if not exists place_y real,         -- box origin Y
  add column if not exists place_w real,         -- box width
  add column if not exists place_h real,         -- box height
  add column if not exists signature_data text;  -- the exact signature PNG applied (data URL)
