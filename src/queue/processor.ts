// src/queue/processor.ts
import { ScrapingJob, Publication, GetJobsResponse } from '../types';
import { getScraperForTribunal } from '../scrapers';
import { sendResult } from '../webhook/sender';

const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

export async function processQueue(): Promise<void> {
  console.log('[QUEUE] Buscando jobs pendentes via Edge Function...');

  try {
    // 1. Buscar jobs pendentes via Edge Function
    const getJobsUrl = `${SUPABASE_PROJECT_URL}/functions/v1/dje-get-pending-jobs`;
    console.log(`[QUEUE] Chamando: ${getJobsUrl}`);
    
    const response = await fetch(getJobsUrl, {
      method: 'GET',
      headers: {
        'x-webhook-secret': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao buscar jobs: ${response.status} - ${errorText}`);
    }

    const data: GetJobsResponse = await response.json();
    console.log(`[QUEUE] ✅ ${data.count || 0} jobs encontrados`);

    if (!data.jobs || data.jobs.length === 0) {
      console.log('[QUEUE] Nenhum job pendente. Aguardando próximo ciclo...');
      return;
    }

    // 2. Processar cada job
    for (const job of data.jobs) {
      await processJob(job);
    }

    console.log('[QUEUE] ✅ Ciclo de processamento concluído');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[QUEUE] ❌ Erro fatal:', errorMessage);
  }
}

async function processJob(job: ScrapingJob): Promise<void> {
  console.log(`[QUEUE] 🔄 Processando job ${job.id}`);
  console.log(`   - OAB: ${job.oab_number}/${job.oab_state}`);
  console.log(`   - Tribunal: ${job.tribunal}`);
  console.log(`   - Data: ${job.target_date}`);
  
  const startTime = Date.now();
  
  try {
    // Obter scraper para o tribunal
    const scraper = getScraperForTribunal(job.tribunal);
    
    if (!scraper) {
      throw new Error(`Scraper não encontrado para tribunal: ${job.tribunal}`);
    }

    // Fazer scraping
    const result = await scraper.scrape(job.oab_number, job.oab_state, job.target_date);
    const publications = result.publications || [];
    
    const processingTime = Date.now() - startTime;
    console.log(`[QUEUE] ✅ Scraping concluído em ${processingTime}ms: ${publications.length} publicações`);
    
    // Enviar resultado para webhook
    await sendResult(job.id, 'completed', publications);
    console.log(`[QUEUE] ✅ Job ${job.id} completado com sucesso`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`[QUEUE] ❌ Erro no job ${job.id}:`, errorMessage);
    await sendResult(job.id, 'failed', [], errorMessage);
  }
}
