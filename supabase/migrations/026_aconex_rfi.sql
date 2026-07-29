-- 026 — Aconex RFI Tracker (read-only mirror of RFI correspondence).
-- One aconex_rfi row per Aconex mail THREAD (= one RFI), rolled up from the
-- mails; aconex_rfi_mail caches every mail in the thread (same shape as
-- CoreCost's cf_pdn_mail) for the RFI Report popup. Fed by
-- costflow-app/scripts/aconex_rfi_sync.py (daily 06:00 scan chain).
-- Idempotent — safe to re-run.

create table if not exists aconex_rfi (
  id uuid primary key default gen_random_uuid(),
  thread_id bigint not null unique,
  mail_no text,                      -- root mail number (e.g. PPET-RFI-000037)
  corr_type text,                    -- Request For Information / Technical Query / Design Query
  title text,                        -- root subject
  package_code text,                 -- short code (K124, K038, …)
  package_full text,                 -- full Aconex package label
  cause text,                        -- form "RFI Cause"
  description text,                  -- form "RFI Description"
  proposed_solution text,            -- form "Proposed Solution"
  impacted_docs text,                -- form "Impacted Specs/ Documents/ Drawings"
  cost_impact boolean,               -- form "Cost Impact"
  cost_impact_details text,
  schedule_impact boolean,           -- form "Schedule Impact"
  schedule_impact_details text,
  to_redline boolean,
  from_org text,                     -- who raised it (root mail sender org)
  from_user text,
  raised_date timestamptz,           -- root mail sent date
  response_due timestamptz,          -- root mail ResponseRequiredDate
  aconex_status text,                -- latest mail's Aconex status
  last_mail_date timestamptz,
  days_silent int,
  mail_count int not null default 0,
  attachment_count int not null default 0,
  court_who text,                    -- org(s) the ball sits with
  court_people text,                 -- unanswered recipients on the latest mail
  court_side text,                   -- 'ppe' | 'other' | ''
  overdue boolean not null default false,  -- any waiting recipient stamped Overdue by Aconex
  closed boolean not null default false,   -- latest mail Closed-Out
  summary text,                      -- AI narrative (aconex_rfi_summarize.py)
  summary_at timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists aconex_rfi_mail (
  id uuid primary key default gen_random_uuid(),
  rfi_id uuid references aconex_rfi(id) on delete cascade,
  mail_id bigint not null unique,
  thread_id bigint,
  mail_no text,
  in_ref_mail_id bigint,
  box text,
  corr_type text,
  subject text,
  status text,
  sent_date timestamptz,
  from_org text,
  from_user text,
  recipients jsonb,
  form_fields jsonb,
  attachments jsonb,
  body_html text
);

create index if not exists aconex_rfi_mail_rfi_idx on aconex_rfi_mail (rfi_id);
create index if not exists aconex_rfi_mail_thread_idx on aconex_rfi_mail (thread_id);

create table if not exists aconex_rfi_sync (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  mail_count int not null default 0,
  thread_count int not null default 0,
  note text
);

-- Standing rule: RLS on every new table (apps read via service role, which bypasses it).
alter table aconex_rfi enable row level security;
alter table aconex_rfi_mail enable row level security;
alter table aconex_rfi_sync enable row level security;
