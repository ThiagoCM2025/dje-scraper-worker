import { scrapers } from '../scrapers';
import { sendWebhook } from '../webhook/sender';

export async function processJob(job: any) {
  const { id, oab_number, tribunal, target_date, user_id } = job;
  
  console.log(`[PROCESSOR] Processando job ${id} - OAB: ${oab_number}, Tribunal: ${tribunal}`);
  
  const scraperFn = scrapers[tribunal];
  
  if (!scraperFn) {
    console.error(`[PROCESSOR] Scraper não encontrado para tribunal: ${tribunal}`);
    await sendWebhook({
      jobId: id,
      status: 'failed',
      error: `Tribunal ${tribunal} não suportado`,
      publications: []
    });
    return;
  }

  try {
    // Chamar scraper (agora retorna ScrapingResult)
    const result = await scraperFn(oab_number, target_date);
    
    if (result.success) {
      console.log(`[PROCESSOR] ✅ Job ${id} concluído: ${result.publications.length} publicações`);
      await sendWebhook({
        jobId: id,
        status: 'completed',
        publications: result.publications
      });
    } else {
      console.error(`[PROCESSOR] ❌ Job ${id} falhou:`, result.error);
      await sendWebhook({
        jobId: id,
        status: 'failed',
        error: result.error || 'Erro no scraping',
        publications: []
      });
    }
  } catch (error) {
    console.error(`[PROCESSOR] ❌ Erro inesperado no job ${id}:`, error);
    await sendWebhook({
      jobId: id,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      publications: []
    });
  }
}
