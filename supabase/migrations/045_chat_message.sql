-- 045_chat_message.sql
-- Project-wide live "Engineering Room" chat for the Actions Cockpit.
-- One room for now ('engineering'); the room column leaves the door open to
-- per-package rooms later. Messages are inserted server-side (service-role,
-- which validates + fans out @mention notifications); the browser SUBSCRIBES
-- via Supabase Realtime, so a SELECT policy for signed-in users + membership in
-- the realtime publication are what make live delivery work. Images live in the
-- Supabase Storage bucket 'chat-uploads' (public); image_url points at them.

create table if not exists public.chat_message (
  id           uuid primary key default gen_random_uuid(),
  room         text not null default 'engineering',
  author_email text not null,
  author_name  text,
  body         text,
  image_url    text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_chat_message_room on public.chat_message (room, created_at desc);

alter table public.chat_message enable row level security;

-- Any signed-in CoreDocs user may READ the room (this is what lets the browser
-- Realtime subscription receive messages). Inserts go through the service-role
-- server, which bypasses RLS — so no insert policy is needed.
drop policy if exists chat_message_read on public.chat_message;
create policy chat_message_read on public.chat_message for select to authenticated using (true);

-- Broadcast inserts over Realtime — idempotent add to the supabase_realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_message'
  ) then
    alter publication supabase_realtime add table public.chat_message;
  end if;
end $$;
