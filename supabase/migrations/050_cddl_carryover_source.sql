-- 050_cddl_carryover_source.sql
--
-- The carry-over register gains a SECOND source.
--
-- Until now every row came from the tender transfer folder — "what physically went out to
-- vendors and needs a number and a border". Jarrod's highlighted K038 CDDL answers a
-- different question: "which K038 engineering should come across to K124 and claim
-- progress". The two barely overlap — 13 documents of 235 — because they were assembled
-- for different purposes, and both end up in the same K124 CDDL.
--
-- So they live in one register with a `source` that says which question a row answers.
-- Merging them without that would leave document control unable to tell a vendor datasheet
-- that needs a border from a site-wide specification that needs crediting.
--
-- The two sources also keep their FILES in different places, which is why mddr_id exists:
--   · tender folder  → a path inside Morné's OneDrive transfer folder (source_path)
--   · K038 highlighted → an mddr_entries row whose file_link points at SharePoint (ENG2)

alter table public.cddl_carryover
  add column if not exists source text not null default 'tender folder',
  -- the mddr_entries row that holds this document's file, for the K038 highlighted set
  add column if not exists mddr_id uuid,
  -- kept alongside mddr_id so a broken lookup is still traceable to a location
  add column if not exists file_link text;

comment on column public.cddl_carryover.source is
  'tender folder | k038 highlighted — which question this row answers, not merely where it came from';

create index if not exists cddl_carryover_source_idx on public.cddl_carryover (source);
