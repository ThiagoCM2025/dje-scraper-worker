import { ScrapingJob, GetJobsResponse } from '../types.js';
import { sendWebhook } from '../webhook/sender.js';
import { scrapeTJSP } from '../scrapers/tjsp.js';

const SUPABASE_URL = process.env.SUPABASE_PROJECT_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export async function processQueue(): Promise<void> {
  console.log('[PROCESSOR] 🔍 Buscando jobs pendentes...');

  try {
    // Buscar jobs via Edge Function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/dje-get-pending-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as GetJobsResponse;
    const { jobs, count } = data;

    if (!jobs || jobs.length === 0) {
      console.log('[PROCESSOR] ℹ️ Nenhum job pendente');
      return;
    }

    console.log(`[PROCESSOR] 📋 ${count} job(s) encontrado(s). Processando...`);

    // Processar cada job
    for (const job of jobs) {
      await processJob(job);
    }

    console.log('[PROCESSOR] ✅ Processamento completo');
  } catch (error) {
    console.error('[PROCESSOR] ❌ Erro ao processar fila:', error);
  }
}

async function processJob(job: ScrapingJob): Promise<void> {
  console.log(`[PROCESSOR] 🔧 Processando job ${job.id} - Tribunal: ${job.tribunal}`);

  try {
    // Executar scraping baseado no tribunal
    const result = await scrapeTJSP(job.oab_number, job.oab_state, job.target_date);

    // Enviar resultado via webhook
    await sendWebhook({
      jobId: job.id,
      status: result.success ? 'completed' : 'failed',
      publications: result.publications,
      error: result.error,
      resultsCount: result.publications.length,
    });

    console.log(`[PROCESSOR] ✅ Job ${job.id} concluído: ${result.publications.length} publicações`);
  } catch (error) {
    console.error(`[PROCESSOR] ❌ Erro no job ${job.id}:`, error);

    // Enviar falha via webhook
    await sendWebhook({
      jobId: job.id,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      resultsCount: 0,
    });
  }
}
