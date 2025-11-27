import type { Browser } from 'playwright';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ScrapingJob {
  id: string;
  user_id: string;
  monitoring_id: string;
  oab_number: string;
  oab_state: string;
  tribunal: string;       // ex: 'TJSP'
  tribunal_type: string;  // ex: 'estadual'
  target_date: string;    // 'YYYY-MM-DD'
  priority: number;
  status: JobStatus;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  retry_count: number | null;
  max_retries: number | null;
  error_message: string | null;
  lawyer_name: string | null;
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

export interface WebhookPayload {
  jobId: string;
  status: 'completed' | 'failed';
  publications?: Publication[];
  error?: string;
  resultsCount?: number;
}

export type TribunalScraper = (browser: Browser, job: ScrapingJob) => Promise<Publication[]>;
