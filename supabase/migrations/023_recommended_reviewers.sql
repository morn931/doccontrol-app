-- Migration 023 — internal submitter's recommended reviewers.
-- Run in the CoreDocs Supabase project: tjzeahdimbekuizegsky (SQL Editor). Idempotent.
--
-- When an internal engineer submits a drawing for review (source='internal'), he may
-- recommend reviewers for the Document Controller. Stored here as [{email,name}]; it
-- prefills the Assign Reviewers sequence and is listed in the email to the Controller.
-- The Controller still has the final say (adds/removes freely before starting review).

alter table batches add column if not exists recommended_reviewers jsonb;

comment on column batches.recommended_reviewers is
  'Internal submit only: [{email,name}] the engineer recommends. Prefills Assign Reviewers; DC has final say.';
