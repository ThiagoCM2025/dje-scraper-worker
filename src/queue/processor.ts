import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScrapingJob } from '../types.js';

function nowIso() {
  return new Date().toISOString();
}

export async function getNextPendingJob(
  supabase: SupabaseClient
): Promise<ScrapingJob | null> {
  const { data, error } = await supabase
    .from('dje_scraping_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso())
    .order('priority', { ascending: false })
    .order('scheduled_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('[WORKER] Erro ao buscar próximo job:', error);
    throw error;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const job = data[0] as ScrapingJob;

  // Marca como processing para evitar pegar duas vezes
  const { error: updateError } = await supabase
    .from('dje_scraping_queue')
    .update({
      status: 'processing',
      started_at: nowIso(),
      error_message: null
    })
    .eq('id', job.id)
    .eq('status', 'pending');

  if (updateError) {
    console.error('[WORKER] Erro ao marcar job como processing:', updateError);
    throw updateError;
  }

  return { ...job, status: 'processing' };
}

export async function markJobFinalStatus(
  supabase: SupabaseClient,
  job: ScrapingJob,
  status: 'completed' | 'failed',
  errorMessage?: string
) {
  const update: Record<string, unknown> = {
    status,
    completed_at: nowIso()
  };

  if (errorMessage) {
    update.error_message = errorMessage.substring(0, 500);
    const retryCount = (job.retry_count ?? 0) + 1;
    update.retry_count = retryCount;

    if (job.max_retries && retryCount < job.max_retries) {
      // simples política de retry: reagenda para +15 minutos
      const nextRetry = new Date();
      nextRetry.setMinutes(nextRetry.getMinutes() + 15);
      update.status = 'pending';
      update.completed_at = null;
      update.started_at = null;
      update['next_retry_at'] = nextRetry.toISOString();
    }
  }

  const { error } = await supabase
    .from('dje_scraping_queue')
    .update(update)
    .eq('id', job.id);

  if (error) {
    console.error('[WORKER] Erro ao atualizar status final do job:', error);
  }
}
