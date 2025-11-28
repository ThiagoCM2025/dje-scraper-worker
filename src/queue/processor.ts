// IMPORTANTE: Caminhos relativos corretos - subir um nível com ../
import { ScrapingJob, GetJobsResponse, ScrapingResult } from '../types';
import { sendWebhook } from '../webhook/sender';
import { scrapeTJSP } from '../scrapers/tjsp';

const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export async function processQueue(): Promise<void> {
  console.log('[PROCESSOR] Fetching pending jobs from Edge Function...');
  
  try {
    // Buscar jobs pendentes via Edge Function
    const response = await fetch(`${SUPABASE_PROJECT_URL}/functions/v1/dje-get-pending-jobs`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PROCESSOR] Edge Function error:', response.status, errorText);
      return;
    }

    const data = await response.json() as GetJobsResponse;
    const { jobs, count } = data;

    if (!jobs || jobs.length === 0) {
      console.log('[PROCESSOR] No pending jobs found');
      return;
    }

    console.log(`[PROCESSOR] Found ${count} jobs to process`);

    // Processar cada job
    for (const job of jobs) {
      await processJob(job);
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PROCESSOR] Error fetching jobs:', errorMessage);
  }
}

async function processJob(job: ScrapingJob): Promise<void> {
  console.log(`[PROCESSOR] Processing job ${job.id} for OAB ${job.oab_number}/${job.oab_state}`);

  try {
    // Executar scraping baseado no tribunal
    let result: ScrapingResult;
    
    switch (job.tribunal.toUpperCase()) {
      case 'TJSP':
        result = await scrapeTJSP(job.oab_number, job.oab_state, job.target_date);
        break;
      default:
        console.log(`[PROCESSOR] Unknown tribunal: ${job.tribunal}, using TJSP scraper`);
        result = await scrapeTJSP(job.oab_number, job.oab_state, job.target_date);
    }

    // Enviar resultado via webhook
    await sendWebhook({
      jobId: job.id,
      status: result.success ? 'completed' : 'failed',
      publications: result.publications,
      error: result.error,
      resultsCount: result.publications.length,
    });

    console.log(`[PROCESSOR] Job ${job.id} completed with ${result.publications.length} publications`);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[PROCESSOR] Error processing job ${job.id}:`, errorMessage);

    // Enviar erro via webhook
    await sendWebhook({
      jobId: job.id,
      status: 'failed',
      error: errorMessage,
      resultsCount: 0,
    });
  }
}
