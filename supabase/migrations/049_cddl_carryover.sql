-- 049_cddl_carryover.sql
--
-- The K038 carry-over register: the tender documents from Jarrod's transfer folder that
-- have to come back into the K124 CDDL, so document control can allocate numbers and
-- areas against a document they can actually open.
--
-- THREE KINDS OF COLUMN, and the distinction is the point of the table:
--   1. provenance_*  — where the file is. Rebuilt by the scanner, never edited.
--   2. ai_*          — what the AI reader found IN the document. Advisory, never edited;
--                      a controller may disagree with it and their decision wins.
--   3. everything else — what DOCUMENT CONTROL decides. These are the editable fields and
--                      they map 1:1 onto the real CDDL's export columns, so a finished row
--                      can be pasted straight into the K124 register.
--
-- Keeping the AI's reading and the controller's decision in SEPARATE columns is deliberate:
-- once they are merged there is no way to tell an extracted value from an approved one,
-- and an extracted document number is exactly the thing nobody should trust blindly.

create table if not exists public.cddl_carryover (
  id uuid primary key default gen_random_uuid(),

  -- stable handle for a document that has no number yet; this is what the register
  -- underlines as the link, and what a controller quotes in conversation
  temp_ref text not null unique,

  -- ── provenance (scanner-owned) ────────────────────────────────────────────
  source_path        text not null,          -- path inside the transfer folder
  source_files       text[]     default '{}',-- every file variant of this one document
  target_package     text,                   -- e.g. "E101 - 36MVA HSDG"
  transfer_subfolder text,
  doc_class          text,                   -- Drawing / Data Sheet / Calculation / …
  legacy_docno       text,                   -- the old number, if it ever had one
  legacy_package     text,                   -- K038 / K124 / K132 / E516B / K125
  legacy_area        text,
  file_bytes         bigint,

  -- ── what the AI reader found in the document (advisory) ───────────────────
  ai_docno        text,
  ai_title        text,
  ai_revision     text,
  ai_status       text,                      -- IFR / IFC / IFU / For Approval …
  ai_discipline   text,
  ai_doc_type     text,
  ai_topic        text,
  ai_summary      text,
  ai_kind         text,                      -- 'drawing' | 'document'
  ai_has_border   boolean,                   -- is it in a project title block at all
  ai_confidence   text,                      -- high | medium | low
  ai_read_at      timestamptz,
  ai_error        text,                      -- why a read failed, so it is visible not silent

  -- ── what document control decides — these ARE the CDDL columns ────────────
  wbs                  text,                 -- Area/ WBS No.
  discipline           text,
  doc_type             text,
  seq_no               text,
  revision             text,
  docno                text,                 -- RDMC Document Number (the new K124 one)
  ppe_docno            text,
  sheet                text,                 -- Sht. # of #
  area_facility        text,
  major_desc           text,
  broad_type           text,
  title                text,                 -- Full Title
  rev_a_transmittal    text,
  rev0_transmittal     text,
  aconex_doc_status    text,
  aconex_review_status text,
  doc_owner            text,
  comments             text,
  due                  text,
  main_group           text,
  sub_group            text,
  bh                   text,
  drawing_pack         text,
  activity_id          text,
  schedule_status      text,

  -- ── workflow ──────────────────────────────────────────────────────────────
  status      text not null default 'pending',   -- pending | done | skipped
  decided_by  text,
  decided_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cddl_carryover_status_idx  on public.cddl_carryover (status);
create index if not exists cddl_carryover_package_idx on public.cddl_carryover (target_package);
create index if not exists cddl_carryover_legacy_idx  on public.cddl_carryover (legacy_docno);

-- Standing rule: every new table ships with RLS on. The anon key is public, and the apps
-- read through the service role, so enabling it costs nothing and closes the table to the
-- outside world.
alter table public.cddl_carryover enable row level security;

-- keep updated_at honest without the app having to remember
create or replace function public.cddl_carryover_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists cddl_carryover_touch on public.cddl_carryover;
create trigger cddl_carryover_touch
  before update on public.cddl_carryover
  for each row execute function public.cddl_carryover_touch();
