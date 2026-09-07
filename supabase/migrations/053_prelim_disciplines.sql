-- 053_prelim_disciplines.sql · Prelim Review — sessions carry the discipline(s) in the room.
--
-- Vossie, 7 Sep 2026: one session with every discipline present has the civil engineers
-- idle while the electrical drawings are reviewed. Sessions are therefore cut by discipline
-- (one or more — a "common layouts" session names them all), and the session list and the
-- drawings table filter on it. Free text array, matched against the COLAB folder names and
-- the CDDL discipline letter; no lookup table needed for a temporary tool.
alter table prelim_session add column if not exists disciplines text[] not null default '{}';
create index if not exists prelim_session_disciplines_idx on prelim_session using gin (disciplines);
