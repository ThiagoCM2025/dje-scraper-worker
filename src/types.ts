export interface ScrapingJob {
  id: string;
  monitoring_id: string;
  tribunal: string;
  oab_number: string;
  oab_state: string;
  search_date: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  publications_found: number;
  created_at: string;
}

export interface Publication {
  id?: string;
  monitoring_id: string;
  job_id: string;
  tribunal: string;
  publish_date: string;
  content: string;
  case_number?: string;
  journal_type?: string;
  journal_edition?: string;
  page_number?: string;
  raw_html?: string;
  created_at?: string;
}

export interface WebhookPayload {
  event: 'job.completed' | 'job.failed';
  job_id: string;
  monitoring_id: string;
  tribunal: string;
  publications?: Publication[];
  error?: string;
  timestamp: string;
}
