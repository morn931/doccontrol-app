-- 037_engineering_decisions.sql
-- Engineering Decision Register (EDR) — Phase 4.
-- A separate, more controlled register than the Action register: only true engineering
-- decisions land here (pushed from an action, or entered manually), each with an
-- approval control loop (Decision Owner/Approver → Approved/Rejected). Fields mirror the
-- PPE_Tech_RDMC_Engineering_Decision_Register.xlsx. Idempotent.

-- Reference: PPE-EDR-0001 upward (atomic, never resets).
create sequence if not exists public.eng_decision_ref_seq;
create or replace function public.next_eng_decision_ref()
returns text language sql volatile as $$
  select 'PPE-EDR-' || lpad(nextval('public.eng_decision_ref_seq')::text, 4, '0')
$$;
grant execute on function public.next_eng_decision_ref() to anon, authenticated, service_role;

create table if not exists public.engineering_decision (
  id                 uuid primary key default gen_random_uuid(),
  decision_ref       text unique not null default public.next_eng_decision_ref(),
  source_action_id   uuid references public.engineering_action(id) on delete set null,  -- pushed-from action
  -- context
  date_raised        date not null default (now() at time zone 'UTC')::date,
  discipline         text,
  area_system        text,
  document_number    text,
  -- the decision (xlsx columns)
  title              text,                              -- Decision Title
  background         text,                              -- Description / Background
  options_considered text,
  decision_made      text,
  rationale          text,
  cost_impact        text check (cost_impact     is null or cost_impact     in ('none','low','medium','high')),
  schedule_impact    text check (schedule_impact is null or schedule_impact in ('none','low','medium','high')),
  safety_impact      text check (safety_impact   is null or safety_impact   in ('none','low','medium','high')),
  priority           text check (priority is null or priority in ('low','medium','high','critical')),
  -- people
  raised_by_email    text, raised_by_name  text,
  owner_email        text, owner_name      text,        -- Decision Owner / Approver
  -- approval control loop
  status             text not null default 'pending_approval'
                       check (status in ('pending_approval','approved','rejected','on_hold','superseded','closed')),
  approved_by_email  text, approved_at timestamptz,
  -- dates & refs
  due_date           date, date_closed date,
  related_documents  text, comments text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_eng_decision_status on public.engineering_decision (status);
create index if not exists idx_eng_decision_owner  on public.engineering_decision (owner_email);
create index if not exists idx_eng_decision_source on public.engineering_decision (source_action_id);

alter table public.engineering_decision enable row level security;
