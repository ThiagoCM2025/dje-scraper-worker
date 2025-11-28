// src/types.ts

export interface ScrapingJob {
  id: string;
  monitoring_id: string;
  tribunal: string;
  target_date: string;
  oab_number: string;
  oab_state: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: number;
  retry_count: number;
  max_retries: number;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface Publication {
  tribunal: string;
  publication_date: string;
  raw_text: string;
  page_number?: number;
  section?: string;
  process_number?: string;
  oab_numbers?: string[];
  monitoring_id?: string;
}

export interface ScrapingResult {
  publications: Publication[];
  tribunal: string;
  searchDate: string;
}

// ✅ NOVO: Tipo para resposta da Edge Function get-pending-jobs
export interface GetJobsResponse {
  jobs: ScrapingJob[];
  count: number;
  message?: string;
}

// ✅ NOVO: Tipo para resposta da Edge Function webhook-receiver
export interface WebhookResponse {
  success: boolean;
  message?: string;
  jobId?: string;
  publicationsInserted?: number;
}
