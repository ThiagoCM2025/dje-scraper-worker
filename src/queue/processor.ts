import { supabase } from '../index';
import { ScrapingJob, Publication } from '../types';
import { getScraperForTribunal } from '../scrapers';
import { sendWebhook } from '../webhook/sender';

export async function processQueue() {
  console.log('🔍 Buscando jobs pendentes...');

  try {
    const { data: jobs, error } = await supabase
      .from('dje_scraping_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', 3)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      console.error('❌ Erro ao buscar jobs:', error);
      return;
    }

    if (!jobs || jobs.length === 0) {
      console.log('ℹ️ Nenhum job pendente encontrado.');
      return;
    }

    console.log(`📋 Encontrados ${jobs.length} jobs para processar`);

    await Promise.allSettled(jobs.map(job => processJob(job as ScrapingJob)));

  } catch (error) {
    console.error('❌ Erro fatal ao processar fila:', error);
  }
}

async function processJob(job: ScrapingJob) {
  console.log(`\n🔄 Processando job ${job.id}`);
  console.log(`   Tribunal: ${job.tribunal}`);
  console.log(`   OAB: ${job.oab_number}`);
  console.log(`   Data: ${job.search_date}`);

  try {
    const { error: updateError } = await supabase
      .from('dje_scraping_queue')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        attempts: job.attempts + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id);

    if (updateError) {
      console.error(`❌ Erro ao atualizar job ${job.id}:`, updateError);
      return;
    }

    console.log(`✅ Job ${job.id} marcado como processing`);

    const scraper = getScraperForTribunal(job.tribunal);
    
    if (!scraper) {
      throw new Error(`Scraper não encontrado para tribunal: ${job.tribunal}`);
    }

    console.log(`🤖 Executando scraping para ${job.tribunal}...`);
    const publications = await scraper.scrape(job.oab_number, job.search_date);
    
    console.log(`📊 Publicações encontradas: ${publications.length}`);

    const { error: completeError } = await supabase
      .from('dje_scraping_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: { publications_count: publications.length },
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id);

    if (completeError) {
      console.error(`❌ Erro ao completar job ${job.id}:`, completeError);
    }

    await sendWebhook({
      job_id: job.id,
      status: 'completed',
      tribunal: job.tribunal,
      oab_number: job.oab_number,
      search_date: job.search_date,
      publications,
      processed_at: new Date().toISOString()
    });

    console.log(`✅ Job ${job.id} concluído com sucesso`);

  } catch (error) {
    console.error(`❌ Erro ao processar job ${job.id}:`, error);

    const { error: failError } = await supabase
      .from('dje_scraping_queue')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Erro desconhecido',
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id);

    if (failError) {
      console.error(`❌ Erro ao marcar job ${job.id} como failed:`, failError);
    }

    await sendWebhook({
      job_id: job.id,
      status: 'failed',
      tribunal: job.tribunal,
      oab_number: job.oab_number,
      search_date: job.search_date,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      processed_at: new Date().toISOString()
    });
  }
}
