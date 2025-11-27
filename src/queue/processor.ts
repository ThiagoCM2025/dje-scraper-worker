import { createClient } from '@supabase/supabase-js';
import { scrapeTJSP } from '../scrapers/tjsp.js';
import { sendWebhook } from '../webhook/sender.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function processQueue() {
  console.log('[QUEUE] 📋 Buscando jobs pending...');

  // Buscar jobs pendentes
  const { data: jobs, error } = await supabase
    .from('dje_scraping_queue')
    .select('*')
    .eq('status', 'pending')
    .lt('retry_count', 3)  // ✅ CORRIGIDO: era attempt_count
    .order('created_at', { ascending: true })
    .limit(5);

  if (error) {
    console.error('[QUEUE] ❌ Erro ao buscar jobs:', error);
    return;
  }

  if (!jobs?.length) {
    console.log('[QUEUE] ⚠️ Nenhum job para processar');
    return;
  }

  console.log(`[QUEUE] ✅ ${jobs.length} jobs encontrados`);

  // Processar cada job
  for (const job of jobs) {
    try {
      console.log(`[QUEUE] 🔄 Processando job ${job.id}`);
      console.log(`[QUEUE] 📍 Tribunal: ${job.tribunal}, OAB: ${job.oab_number}, Data: ${job.target_date}`);

      // Marcar como processing
      await supabase
        .from('dje_scraping_queue')
        .update({
          status: 'processing',
          started_at: new Date().toISOString(),
          retry_count: (job.retry_count || 0) + 1  // ✅ CORRIGIDO: era attempt_count
        })
        .eq('id', job.id);

      // Executar scraping baseado no tribunal
      let publications: any[] = [];
      
      const tribunal = job.tribunal?.toUpperCase();
      console.log(`[QUEUE] 🔍 Iniciando scraping para ${tribunal}...`);
      
      if (tribunal === 'TJSP' || tribunal === 'SP') {
        publications = await scrapeTJSP(
          job.oab_number, 
          job.oab_state || 'SP',
          job.lawyer_name,
          job.target_date
        );
      } else {
        console.log(`[QUEUE] ⚠️ Tribunal ${tribunal} não suportado ainda`);
      }

      // Atualizar job como completed
      await supabase
        .from('dje_scraping_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          publications_found: publications.length
        })
        .eq('id', job.id);

      // Enviar resultados via webhook
      await sendWebhook({
        jobId: job.id,
        status: 'completed',
        publications,
        resultsCount: publications.length
      });

      console.log(`[QUEUE] ✅ Job ${job.id} concluído - ${publications.length} publicações`);

    } catch (error: any) {
      console.error(`[QUEUE] ❌ Erro no job ${job.id}:`, error);

      // Atualizar job como failed
      await supabase
        .from('dje_scraping_queue')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error?.message || 'Erro desconhecido'
        })
        .eq('id', job.id);

      // Enviar erro via webhook
      await sendWebhook({
        jobId: job.id,
        status: 'failed',
        error: error?.message || 'Erro desconhecido'
      });
    }
  }

  console.log('[QUEUE] 🏁 Processamento da fila finalizado');
}
