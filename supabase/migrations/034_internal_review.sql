-- 034_internal_review.sql
-- Phase 1 of the "Internal Review" stream: a 4th review front-door for internal working
-- documents (Word/Excel/PDF) that have NO vendor and NO document number yet, reviewed in
-- native form and kept isolated from the engineer-facing (Aconex-synced) SharePoint until
-- they are later signed + issued. See CLAUDE.md changelog / the reject-vs-internal design.
--
-- This migration only adds a source value + a temporary-reference facility. Sign-off,
-- PDF conversion, RDMC-number binding and Aconex issue are Phase 2/3. Idempotent.

-- 1. Allow the new batch source. (batches_source_check last set in 026 to
--    vendor/internal/redline/asbuilt.)
alter table public.batches drop constraint if exists batches_source_check;
alter table public.batches add  constraint batches_source_check
  check (source in ('vendor','internal','redline','asbuilt','internal_review'));

-- 2. Temporary internal reference (e.g. INT-2026-0007) — used until/unless the document
--    graduates to Aconex and gets a real RDMC number (Phase 3).
alter table public.batches add column if not exists internal_ref text;
create index if not exists idx_batches_internal_ref
  on public.batches (internal_ref) where internal_ref is not null;

-- 3. Ref generator: a global monotonic sequence + an RPC the app calls to mint the next
--    reference atomically. Year is cosmetic (stamped at creation); numbering does not reset.
create sequence if not exists public.internal_ref_seq;

create or replace function public.next_internal_ref()
returns text
language sql
volatile
as $$
  select 'INT-' || to_char((now() at time zone 'UTC'), 'YYYY') || '-'
      || lpad(nextval('public.internal_ref_seq')::text, 4, '0')
$$;

grant execute on function public.next_internal_ref() to anon, authenticated, service_role;

comment on column public.batches.internal_ref is 'Temporary reference for an internal-review document with no RDMC number yet (INT-YYYY-NNNN).';
comment on function public.next_internal_ref() is 'Mints the next INT-YYYY-NNNN reference (atomic via internal_ref_seq).';
