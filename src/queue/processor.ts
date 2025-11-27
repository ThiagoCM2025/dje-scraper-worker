import { createClient } from '@supabase/supabase-js';
import { ScrapingJob, Publication } from '../types.js';
import { sendWebhook } from '../webhook/sender.js';
import { getScraperForTribunal } from '../scrapers/index.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function processQueue(): Promise<void> {
  // Buscar próximo job pendente
  const { data: jobs, error } = await supabase
    .from('dje_scraping_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Erro ao buscar jobs:', error);
    return;
  }

  if (!jobs || jobs.length === 0) {
    console.log('Nenhum job pendente na fila');
    return;
  }

  const job = jobs[0] as ScrapingJob;
  console.log(`📋 Processando job ${job.id} - ${job.tribunal} - OAB ${job.oab_number}/${job.oab_state}`);

  try {
    // Marcar como processando
    await supabase
      .from('dje_scraping_queue')
      .update({ 
        status: 'processing', 
        started_at: new Date().toISOString() 
      })
      .eq('id', job.id);

    // Obter scraper apropriado
    const scraper = getScraperForTribunal(job.tribunal);
    
    // Executar scraping
    const publications = await scraper.scrape({
      oabNumber: job.oab_number,
      oabState: job.oab_state,
      searchDate: job.search_date,
    });

    console.log(`✅ Encontradas ${publications.length} publicações`);

    // Salvar publicações no banco
    if (publications.length > 0) {
      const publicationsToInsert = publications.map((pub: Publication) => ({
        ...pub,
        monitoring_id: job.monitoring_id,
        job_id: job.id,
        tribunal: job.tribunal,
      }));

      const { error: insertError } = await supabase
        .from('dje_publications')
        .insert(publicationsToInsert);

      if (insertError) {
        console.error('Erro ao salvar publicações:', insertError);
      }
    }

    // Marcar job como concluído
    await supabase
      .from('dje_scraping_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        publications_found: publications.length,
      })
      .eq('id', job.id);

    // Enviar webhook de sucesso
    await sendWebhook({
      event: 'job.completed',
      job_id: job.id,
      monitoring_id: job.monitoring_id,
      tribunal: job.tribunal,
      publications,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error(`❌ Erro ao processar job ${job.id}:`, error);

    // Marcar job como falhou
    await supabase
      .from('dje_scraping_queue')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error.message || 'Erro desconhecido',
      })
      .eq('id', job.id);

    // Enviar webhook de erro
    await sendWebhook({
      event: 'job.failed',
      job_id: job.id,
      monitoring_id: job.monitoring_id,
      tribunal: job.tribunal,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
