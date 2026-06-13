-- ============================================================
-- Add file_link + normalized_document_number to the semantic search RPC
-- Migration: 007_match_mddr_filelink.sql  (idempotent — CREATE OR REPLACE)
-- So semantic (Smart search) results also get the Open button + revisions.
-- ============================================================
-- Return-type change requires dropping the old function first.
DROP FUNCTION IF EXISTS match_mddr(vector, int, text, text, boolean);

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
  normalized_document_number text,
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
  file_link           text,
  ai_text             text,
  similarity          float
)
LANGUAGE sql STABLE
AS $$
  SELECT e.id, e.document_number, e.normalized_document_number, e.document_title, e.package_code,
         e.vendor_name, e.source_type, e.discipline, e.document_type, e.document_status, e.revision,
         e.progress_percent, e.review_outcome_code, e.tag_number, e.file_link, e.ai_text,
         1 - (e.embedding <=> query_embedding) AS similarity
  FROM mddr_entries e
  WHERE e.embedding IS NOT NULL AND e.is_active = true
    AND (p_awarded IS NULL OR e.is_awarded = p_awarded)
    AND (p_package IS NULL OR e.package_code = p_package)
    AND (p_source  IS NULL OR e.source_type = p_source)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count
$$;

GRANT EXECUTE ON FUNCTION match_mddr TO service_role, authenticated;
