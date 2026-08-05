-- 038_engineering_action_source_date.sql
-- Carry the source date for AI-pulled actions (the meeting/email date the item was picked
-- up on), so the register can show "via Meeting · 30 Jul" and sort newest-first. Idempotent.
alter table public.engineering_action add column if not exists source_date date;
create index if not exists idx_eng_action_source_date on public.engineering_action (source_date);
