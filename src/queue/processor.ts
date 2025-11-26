import { createClient } from '@supabase/supabase-js';
import { scrapeTJSP } from '../scrapers/tjsp.js';
import { sendWebhook } from '../webhook/sender.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function processQueue() {
  console.log(`\n⏰ [${new Date().toISOString()}] Verificando fila...`);

  try {
    // Buscar jobs pendentes
    const { data: jobs, error } = await supabase
      .from('dje_scraping_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      console.error('❌ Erro ao buscar jobs:', error);
      return;
    }

    if (!jobs || jobs.length === 0) {
      console.log('📭 Nenhum job pendente');
      return;
    }

    console.log(`📋 ${jobs.length} job(s) encontrado(s)`);

    for (const job of jobs) {
      await processJob(job);
    }
  } catch (err) {
    console.error('❌ Erro no processamento:', err);
  }
}

async function processJob(job: any) {
  console.log(`\n🔄 Processando job ${job.id}...`);
  console.log(`   OAB: ${job.oab_number}/${job.oab_state}`);

  try {
    // Atualizar status para processing
    await supabase
      .from('dje_scraping_queue')
      .update({ 
        status: 'processing',
        started_at: new Date().toISOString()
      })
      .eq('id', job.id);

    // Executar scraping
    const result = await scrapeTJSP({
      oabNumber: job.oab_number,
      oabState: job.oab_state,
      startDate: job.start_date,
      endDate: job.end_date
    });

    console.log(`📊 Resultado: ${result.publications.length} publicações`);

    // Enviar para webhook
    await sendWebhook({
      jobId: job.id,
      visitorId: job.visitor_id,
      visitorType: job.visitor_type,
      ...result
    });

    // Atualizar status para completed
    await supabase
      .from('dje_scraping_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: result
      })
      .eq('id', job.id);

    console.log(`✅ Job ${job.id} concluído`);

  } catch (err: any) {
    console.error(`❌ Erro no job ${job.id}:`, err.message);

    await supabase
      .from('dje_scraping_queue')
      .update({
        status: 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
  }
}
