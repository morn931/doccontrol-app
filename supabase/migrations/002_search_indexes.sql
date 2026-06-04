-- ============================================================
-- PPE Tech Document Control App — Search Indexes
-- Migration: 002_search_indexes.sql
-- ============================================================

-- Full-text search vector on document_versions
ALTER TABLE document_versions
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(doc_name,        '')), 'A') ||
    setweight(to_tsvector('english', coalesce(file_name,       '')), 'A') ||
    setweight(to_tsvector('english', coalesce(discipline,      '')), 'B') ||
    setweight(to_tsvector('english', coalesce(document_type,   '')), 'B') ||
    setweight(to_tsvector('english', coalesce(topic,           '')), 'B') ||
    setweight(to_tsvector('english', coalesce(ai_text,         '')), 'C') ||
    setweight(to_tsvector('english', coalesce(extracted_text,  '')), 'C')
  ) STORED;

CREATE INDEX document_versions_search_idx
  ON document_versions USING GIN(search_vector);

-- Trigram indexes for partial document number matching
CREATE INDEX document_versions_docnum_trgm
  ON document_versions USING GIN(coalesce(file_name, '') gin_trgm_ops);

CREATE INDEX documents_docnum_trgm
  ON documents USING GIN(coalesce(normalized_document_number, '') gin_trgm_ops);

-- General performance indexes
CREATE INDEX batches_status_idx          ON batches(status);
CREATE INDEX batches_received_at_idx     ON batches(received_at DESC);
CREATE INDEX batches_vendor_id_idx       ON batches(vendor_id);
CREATE INDEX batches_package_id_idx      ON batches(package_id);
CREATE INDEX document_versions_batch_idx ON document_versions(batch_id);
CREATE INDEX document_versions_doc_idx   ON document_versions(document_id);
CREATE INDEX document_versions_latest_idx ON document_versions(document_id, is_latest);
CREATE INDEX document_versions_status_idx ON document_versions(status);
CREATE INDEX review_tasks_batch_idx      ON review_tasks(batch_id);
CREATE INDEX review_tasks_reviewer_idx   ON review_tasks(reviewer_email);
CREATE INDEX review_tasks_status_idx     ON review_tasks(status);
CREATE INDEX review_tasks_docver_seq_idx ON review_tasks(document_version_id, sequence_number);
CREATE INDEX audit_events_entity_idx     ON audit_events(entity_type, entity_id);
CREATE INDEX audit_events_created_idx    ON audit_events(created_at DESC);
