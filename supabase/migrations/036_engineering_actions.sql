-- 036_engineering_actions.sql
-- Engineering Action Register — Phase 1.
-- Actions raised from design reviews (the reworked "yellow function") land in a durable
-- register with an owner + status + a reply thread (which closes the "the raiser never
-- sees the answer" loop). The plain reviewer note stays as-is (reviewer_notes) — this is
-- additive. Decisions share this engine later via record_type; AI-staged meeting/email
-- actions (suggested=true) + the EM weekly management view are Phase 2/3. Idempotent.

-- 1. Role capability flags.
--    eng_action_manager = may close / delete / (re)prioritise actions (the "EM flag").
--    is_engineering     = role whose actions get pulled into the register (Phase-3 seam).
alter table public.role_definitions add column if not exists eng_action_manager boolean not null default false;
alter table public.role_definitions add column if not exists is_engineering     boolean not null default false;
update public.role_definitions set eng_action_manager = true where role in ('engineering_manager','admin','developer');
update public.role_definitions set is_engineering     = true where role in ('engineering_manager','reviewer');

-- 2. Action reference: PPE-EAR-0001 upward (atomic, never resets).
create sequence if not exists public.eng_action_ref_seq;
create or replace function public.next_eng_action_ref()
returns text language sql volatile as $$
  select 'PPE-EAR-' || lpad(nextval('public.eng_action_ref_seq')::text, 4, '0')
$$;
grant execute on function public.next_eng_action_ref() to anon, authenticated, service_role;

-- 3. The register.
create table if not exists public.engineering_action (
  id                  uuid primary key default gen_random_uuid(),
  action_ref          text unique not null default public.next_eng_action_ref(),
  record_type         text not null default 'action',        -- 'action' | 'decision' (later)
  -- raised
  raised_by_email     text,
  raised_by_name      text,
  raised_at           timestamptz not null default now(),
  -- context (defaults come from the document under review)
  document_number     text,
  document_version_id uuid,
  batch_id            uuid,
  discipline          text,
  area_system         text,
  -- the action
  title               text,
  description         text not null,
  -- ownership (who follows up / closes)
  assigned_to_email   text,
  assigned_to_name    text,
  -- management (Engineering Manager only — enforced in the app)
  priority            text check (priority is null or priority in ('low','medium','high')),
  status              text not null default 'open' check (status in ('open','in_progress','closed','dismissed')),
  due_date            date,
  closed_at           timestamptz,
  closed_by_email     text,
  closeout_comment    text,
  -- provenance (Phase-3 seams)
  source              text not null default 'design_review' check (source in ('design_review','meeting','email','manual')),
  source_ref          text,
  suggested           boolean not null default false,        -- true = AI-staged, awaiting confirm
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_eng_action_status   on public.engineering_action (status);
create index if not exists idx_eng_action_assignee on public.engineering_action (assigned_to_email);
create index if not exists idx_eng_action_batch    on public.engineering_action (batch_id);
create index if not exists idx_eng_action_docnum   on public.engineering_action (document_number);

-- 4. Reply thread — the loop-closer (raiser is notified when the assignee responds/closes).
create table if not exists public.engineering_action_reply (
  id           uuid primary key default gen_random_uuid(),
  action_id    uuid not null references public.engineering_action(id) on delete cascade,
  author_email text,
  author_name  text,
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_eng_action_reply_action on public.engineering_action_reply (action_id);

-- 5. RLS on (the app reads/writes via the service-role client, which bypasses RLS).
alter table public.engineering_action       enable row level security;
alter table public.engineering_action_reply enable row level security;
