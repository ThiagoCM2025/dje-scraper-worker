import 'dotenv/config';
import { chromium, Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@supabase/supabase-js';
import type { ScrapingJob } from './types.js';
import { getNextPendingJob, markJobFinalStatus } from './queue/processor.js';
import { getScraperForJob } from './scrapers/index.js';
import { sendWebhookUpdate } from './webhook/sender.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[WORKER] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados. Encerrando.');
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processSingleJob(browser: Browser, job: ScrapingJob) {
  console.log('[WORKER] Processando job', job.id, 'TJ', job.tribunal, 'OAB', job.oab_number, job.oab_state);

  const scraper = getScraperForJob(job);

  try {
    const publications = await scraper(browser, job);

    console.log('[WORKER] Scraping concluído. Publicações encontradas:', publications.length);

    // Envia para o webhook (dje-webhook-receiver)
    await sendWebhookUpdate(job.id, 'completed', publications);

    console.log('[WORKER] Job', job.id, 'enviado para webhook com sucesso.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[WORKER] Erro ao processar job', job.id, ':', message);

    try {
      // Notifica falha ao backend via webhook
      await sendWebhookUpdate(job.id, 'failed', [], message);
    } catch (webhookError) {
      console.error('[WORKER] Erro ao enviar falha para webhook:', webhookError);
    }

    await markJobFinalStatus(supabase, job, 'failed', message);
  }
}

async function mainLoop() {
  console.log('[WORKER] Iniciando loop principal de processamento de fila');

  const browser = await chromium.launch({ headless: true });

  try {
    while (true) {
      const job = await getNextPendingJob(supabase);

      if (!job) {
        // Nada para fazer; aguarda um pouco
        await sleep(10_000);
        continue;
      }

      await processSingleJob(browser, job);
    }
  } catch (error) {
    console.error('[WORKER] Erro fatal no loop principal:', error);
  } finally {
    await browser.close();
  }
}

mainLoop().catch((err) => {
  console.error('[WORKER] Erro não tratado:', err);
  process.exit(1);
});
