export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type BatchStatus =
  | 'intake_received' | 'metadata_pending' | 'ready_for_reviewer_assignment'
  | 'review_ready_to_start' | 'review_in_progress' | 'review_complete'
  | 'transmittal_generated' | 'returned_to_vendor'
  | 'rejected_before_review' | 'cancelled' | 'failed'

export type ReviewTaskStatus =
  | 'pending' | 'sent' | 'opened' | 'in_progress'
  | 'completed' | 'skipped' | 'cancelled' | 'needs_more_review' | 'overdue'

export type ReviewOutcomeCode = 'A1' | 'B1' | 'B2' | 'C1' | 'D1' | 'Q1' | 'V1' | 'S1'

export type UserRole =
  | 'admin' | 'document_controller' | 'reviewer'
  | 'engineering_manager' | 'project_manager' | 'vendor'

export type DocumentVersionStatus =
  | 'uploaded' | 'processing' | 'ready' | 'under_review'
  | 'review_complete' | 'returned' | 'rejected' | 'superseded'

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string; auth_user_id: string | null; email: string; full_name: string
          role: UserRole; department: string | null; discipline: string | null
          active: boolean; created_at: string; updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['users']['Insert']>
      }
      vendors: {
        Row: {
          id: string; name: string; code: string
          primary_contact_email: string | null; active: boolean
          created_at: string; updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['vendors']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['vendors']['Insert']>
      }
      packages: {
        Row: {
          id: string; package_code: string; package_name: string
          vendor_id: string | null; project: string | null; active: boolean; created_at: string
        }
        Insert: Omit<Database['public']['Tables']['packages']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['packages']['Insert']>
      }
      vendor_sites: {
        Row: {
          id: string; vendor_id: string | null; package_id: string | null
          site_url: string; dropoff_library: string | null; return_library: string | null
          return_folder: string | null; source_list_id: string | null; target_list_id: string | null
          controller_email: string | null; active: boolean; created_at: string
        }
        Insert: Omit<Database['public']['Tables']['vendor_sites']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['vendor_sites']['Insert']>
      }
      batches: {
        Row: {
          id: string; batch_guid: string; vendor_id: string | null; package_id: string | null
          source_site_url: string | null; source_library: string | null; target_library: string | null
          controller_user_id: string | null; controller_email: string | null
          status: BatchStatus; file_count: number; comments: string | null
          reject_reason: string | null; vendor_email: string | null
          received_at: string; started_at: string | null; completed_at: string | null
          returned_at: string | null; rejected_at: string | null
          created_at: string; updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['batches']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['batches']['Insert']>
      }
      documents: {
        Row: {
          id: string; normalized_document_number: string | null; display_document_number: string | null
          title: string | null; vendor_id: string | null; package_id: string | null
          discipline: string | null; document_type: string | null; topic: string | null
          current_version_id: string | null; created_at: string; updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['documents']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['documents']['Insert']>
      }
      document_versions: {
        Row: {
          id: string; document_id: string | null; batch_id: string | null
          file_name: string; revision: string | null; revision_sort: string | null
          version_number: number | null; source_site_url: string | null
          source_file_url: string | null; central_file_url: string | null
          reviewed_file_url: string | null; returned_file_url: string | null
          storage_provider: string; storage_path: string | null
          file_hash: string | null; file_size: number | null; mime_type: string | null
          doc_unique_id: string | null; ai_text: string | null; extracted_text: string | null
          doc_name: string | null; discipline: string | null; document_type: string | null
          topic: string | null; ai_metadata_source: string; status: DocumentVersionStatus
          is_latest: boolean; uploaded_at: string; returned_at: string | null
          created_at: string; updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['document_versions']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['document_versions']['Insert']>
      }
      review_tasks: {
        Row: {
          id: string; batch_id: string | null; document_id: string | null
          document_version_id: string | null; reviewer_user_id: string | null
          reviewer_email: string; sequence_number: number; status: ReviewTaskStatus
          date_sent: string | null; date_opened: string | null; date_completed: string | null
          due_date: string | null; review_outcome_code: ReviewOutcomeCode | null
          review_outcome_text: string | null; internal_status: string | null
          comment: string | null; markup_summary: string | null; markup_status: string
          markup_extracted_on: string | null; markup_source_doc_url: string | null
          is_manager_override: boolean; manager_override_by: string | null
          manager_override_date: string | null; created_at: string; updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['review_tasks']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['review_tasks']['Insert']>
      }
      import_runs: {
        Row: {
          id: string; source: string | null; started_by: string | null
          started_at: string; completed_at: string | null; status: string; mode: string
          records_scanned: number; records_created: number; records_updated: number
          records_failed: number; error_log: string | null
        }
        Insert: Omit<Database['public']['Tables']['import_runs']['Row'], 'id' | 'started_at'>
        Update: Partial<Database['public']['Tables']['import_runs']['Insert']>
      }
      system_settings: {
        Row: { key: string; value: string | null; updated_at: string }
        Insert: { key: string; value?: string | null }
        Update: { value?: string | null }
      }
    }
  }
}
