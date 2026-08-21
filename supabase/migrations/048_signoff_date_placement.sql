-- ============================================================================
-- 048_signoff_date_placement.sql · Independent date position for sign-off stamps
-- The date was always drawn at a fixed offset below the (movable) signature box
-- (lib/signoff-pdf.ts), so on tight title-block layouts — or once a signature is
-- dragged close to the printed name — the date could land on the name instead of
-- clearly under the signature. This lets the date be nudged independently once,
-- same "arrow button" interaction as the existing signature reposition.
-- NULL = not yet customised; falls back to the existing relative-offset behaviour
-- (lib/signoff-pdf.ts stampSpec.dateX/dateY are optional). Idempotent.
-- ============================================================================

alter table signoff_tasks add column if not exists place_date_x real;
alter table signoff_tasks add column if not exists place_date_y real;
