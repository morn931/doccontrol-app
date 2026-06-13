-- ============================================================
-- MDDR semantic search — pgvector embeddings over the AI summaries
-- Migration: 005_mddr_semantic.sql  (idempotent)
-- Apply in the DocControl Supabase project (tjzeahdimbekuizegsky).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- AI summary copied onto matched MDDR rows (from document_versions during Sync
-- Progress) + the embedding vector used for semantic search.
ALTER TABLE mddr_entries ADD COLUMN IF NOT EXISTS ai_text     TEXT;
ALTER TABLE mddr_entries ADD COLUMN IF NOT EXISTS embedding   vector(1536);
ALTER TABLE mddr_entries ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

-- Approximate-nearest-neighbour index (cosine).
CREATE INDEX IF NOT EXISTS mddr_entries_embedding_idx
  ON mddr_entries USING hnsw (embedding vector_cosine_ops);

-- ── Vector search RPC ───────────────────────────────────────
-- Returns the closest documents to a query embedding, with optional filters.
-- similarity = 1 - cosine distance (1.0 = identical).
CREATE OR REPLACE FUNCTION match_mddr(
  query_embedding vector(1536),
  match_count     int     DEFAULT 30,
  p_package       text    DEFAULT NULL,
  p_source        text    DEFAULT NULL,
  p_awarded       boolean DEFAULT true
)
RETURNS TABLE (
  id                  uuid,
  document_number     text,
  document_title      text,
  package_code        text,
  vendor_name         text,
  source_type         text,
  discipline          text,
  document_type       text,
  document_status     text,
  revision            text,
  progress_percent    numeric,
  review_outcome_code text,
  tag_number          text,
  ai_text             text,
  similarity          float
)
LANGUAGE sql STABLE
AS $$
  SELECT e.id, e.document_number, e.document_title, e.package_code, e.vendor_name,
         e.source_type, e.discipline, e.document_type, e.document_status, e.revision,
         e.progress_percent, e.review_outcome_code, e.tag_number, e.ai_text,
         1 - (e.embedding <=> query_embedding) AS similarity
  FROM mddr_entries e
  WHERE e.embedding IS NOT NULL
    AND e.is_active = true
    AND (p_awarded IS NULL OR e.is_awarded = p_awarded)
    AND (p_package IS NULL OR e.package_code = p_package)
    AND (p_source  IS NULL OR e.source_type = p_source)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count
$$;

GRANT EXECUTE ON FUNCTION match_mddr TO service_role, authenticated;
