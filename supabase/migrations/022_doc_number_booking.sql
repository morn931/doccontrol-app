-- Migration 022 — Drawing Number Picker: book out an existing (placeholder) number.
-- Run in the CoreDocs Supabase project: tjzeahdimbekuizegsky (SQL Editor). Idempotent.
--
-- A placeholder = an Aconex Review Tracker row (aconex_review_doc) whose court is
-- 'NOT_TRANSMITTED' ("not yet submitted — PPE") owned by FV/MC/VV or blank. Booking a
-- placeholder claims that number against a user and links the Document Request created
-- for it. Kept in its own table so the daily Aconex/CDDL sync can't wipe the booking.

create table if not exists doc_number_booking (
  id              uuid primary key default gen_random_uuid(),
  docno           text not null,
  package_code    text,
  title           text,
  discipline      text,
  booked_by       uuid references users(id) on delete set null,
  booked_by_email text,
  request_id      uuid references document_number_request(id) on delete set null,
  request_line_id uuid references document_number_request_line(id) on delete set null,
  released        boolean not null default false,
  created_at      timestamptz not null default now()
);

-- one ACTIVE booking per number (a released booking frees it to be booked again)
create unique index if not exists doc_number_booking_active_uq on doc_number_booking (docno) where released = false;
create index if not exists doc_number_booking_by_idx on doc_number_booking (booked_by);

-- RLS (standing rule: every new table). Authenticated read; writes via the service-role client.
alter table doc_number_booking enable row level security;
drop policy if exists doc_number_booking_read on doc_number_booking;
create policy doc_number_booking_read on doc_number_booking for select to authenticated using (true);
