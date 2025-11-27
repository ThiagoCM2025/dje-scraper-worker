// src/types.ts

export interface ScrapingJob {
  id: string;
  user_id: string;
  monitoring_id: string;
  tribunal: string;
  oab_number: string;
  oab_state: string;
  target_date: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: number;
  attempts: number;
  max_attempts: number;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  created_at: string;
}

export interface Publication {
  processo_numero?: string;
  processo_partes?: string;
  intimacao_texto: string;
  publicacao_data: string;
  tipo_publicacao?: string;
  prazo_dias?: number;
  prazo_data?: string;
  documento_url?: string;
  raw_text?: string;
  page_number?: number;
  section?: string;
}

export interface ScrapingResult {
  publications: Publication[];
  metadata?: {
    pages_scraped?: number;
    execution_time_ms?: number;
  };
}

export interface GetJobsResponse {
  jobs: ScrapingJob[];
  count: number;
  message?: string;
}

export interface WebhookResponse {
  success: boolean;
  message?: string;
  error?: string;
}
