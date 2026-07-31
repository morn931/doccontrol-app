-- 028_rev0_intake.sql
-- Vendor Rev 0+ issued documents (ruled 2026-07-31): vendors drop these in the
-- "Rev 0 and up Documents" folder on their vendor site and email Doc Control.
-- The Rev 0 Intake screen lets the controller stamp them (PPE stamp, fields
-- auto-filled), write the stamped copy BACK over the vendor's file, and file a
-- copy in our per-package bucket. This table is the register of every stamp.
create table if not exists rev0_intake (
  id               uuid primary key default gen_random_uuid(),
  package_id       uuid references packages(id) on delete set null,
  document_number  text not null,
  revision         text,
  outcome          text,                -- e.g. 'A1 - APPROVED' (as printed on the stamp)
  stamp_date       date,
  file_name        text,
  vendor_file_url  text,                -- the vendor-site copy (replaced with the stamped file)
  bucket_file_url  text,                -- our DocumentControl bucket copy
  stamped_by_email text,
  created_at       timestamptz not null default now()
);
create index if not exists rev0_intake_pkg_idx on rev0_intake(package_id);
alter table rev0_intake enable row level security;
drop policy if exists rev0_intake_read on rev0_intake;
create policy rev0_intake_read on rev0_intake for select to authenticated using (true);

insert into role_permissions (feature_key, role, allowed) values
  ('nav.rev0_intake','document_controller',true),
  ('nav.rev0_intake','admin',true),
  ('nav.rev0_intake','developer',true),
  ('action.rev0_stamp','document_controller',true),
  ('action.rev0_stamp','admin',true),
  ('action.rev0_stamp','developer',true)
on conflict (feature_key, role) do update set allowed = excluded.allowed;
