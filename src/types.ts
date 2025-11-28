/**
 * SINGLE SOURCE OF TRUTH - Railway Worker Types
 * Compatível com Edge Functions e Schema do Banco
 */

export interface ScrapingJob {
  id: string;
  user_id: string;
  monitoring_id: string;
  oab_number: string;
  oab_state: string;
  tribunal: string;
  target_date: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  publications_found?: number;
}

export interface Publication {
  date: string;
  type: string;
  text: string;
  processNumber?: string;
  parties?: string[];
  lawyers?: string[];
  urgency: 'low' | 'normal' | 'high' | 'critical';
  source: string;
}

export interface ScrapingResult {
  success: boolean;
  publications: Publication[];
  error?: string;
}

export interface WebhookPayload {
  jobId: string;
  status: 'completed' | 'failed';
  publications?: Publication[];
  error?: string;
  resultsCount?: number;
}

export interface GetJobsResponse {
  jobs: ScrapingJob[];
  count: number;
  message?: string;
}

export interface WebhookResponse {
  success: boolean;
  publicationsInserted: number;
}
