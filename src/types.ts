// Tipos compartilhados para o Railway Worker

export interface ScrapingJob {
  id: string;
  user_id: string;
  monitoring_id: string;
  oab_number: string;
  oab_state: string;
  target_date: string;
  tribunal: string;
  status: string;
  priority: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
  publications_found: number;
}

// Publication format expected by dje-webhook-receiver
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
  error?: string;
}

export interface WebhookResponse {
  success: boolean;
  publicationsInserted?: number;
  error?: string;
}
