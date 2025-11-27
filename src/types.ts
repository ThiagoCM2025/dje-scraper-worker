export interface ScrapingJob {
  id: string;
  oab_number: string;
  oab_state: string;
  tribunal: string;
  target_date: string;
  status: string;
  priority: number;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
}

export interface Publication {
  text: string;
  date: string;
  type?: string;
  processNumber?: string;
}

export interface WebhookPayload {
  jobId: string;
  status: string;
  publications: Publication[];
  error: string | null;
  resultsCount: number;
}
