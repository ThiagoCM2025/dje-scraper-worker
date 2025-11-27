export interface ScrapingJob {
  id: string;
  user_id: string;
  tribunal: string;
  oab_number: string;
  search_date: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: number;
  attempts: number;
  max_attempts: number;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  result?: any;
  created_at: string;
  updated_at: string;
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
}

export interface WebhookPayload {
  job_id: string;
  status: 'completed' | 'failed';
  tribunal: string;
  oab_number: string;
  search_date: string;
  publications?: Publication[];
  error?: string;
  processed_at: string;
}
