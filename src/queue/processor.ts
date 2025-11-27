const { scrapeTJSP } = require('../scrapers/tjsp');

const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

async function processQueue() {
  console.log('[QUEUE] Buscando jobs pendentes via Edge Function...');

  if (!SUPABASE_PROJECT_URL || !WEBHOOK_SECRET) {
    console.error('[QUEUE] ❌ Variáveis de ambiente não configuradas!');
    console.error('  - SUPABASE_PROJECT_URL:', SUPABASE_PROJECT_URL ? '✓' : '✗');
    console.error('  - WEBHOOK_SECRET:', WEBHOOK_SECRET ? '✓' : '✗');
    return;
  }

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

    const { jobs, count } = await response.json();
    console.log(`[QUEUE] ✅ ${count || 0} jobs encontrados`);

    if (!jobs || jobs.length === 0) {
      console.log('[QUEUE] Nenhum job pendente. Aguardando próximo ciclo...');
      return;
    }

    // 2. Processar cada job
    for (const job of jobs) {
      console.log(`[QUEUE] 🔄 Processando job ${job.id}`);
      console.log(`  - OAB: ${job.oab_number}/${job.oab_state}`);
      console.log(`  - Tribunal: ${job.tribunal}`);
      console.log(`  - Data: ${job.target_date}`);
      
      try {
        // Fazer scraping
        const result = await scrapeTJSP(job.oab_number, job.oab_state, job.target_date);
        
        // Enviar resultado para webhook
        await sendResult(job.id, 'completed', result.publications || []);
        console.log(`[QUEUE] ✅ Job ${job.id} completado: ${(result.publications || []).length} publicações`);
        
      } catch (error) {
        console.error(`[QUEUE] ❌ Erro no job ${job.id}:`, error.message);
        await sendResult(job.id, 'failed', [], error.message);
      }
    }

    console.log('[QUEUE] ✅ Ciclo de processamento concluído');

  } catch (error) {
    console.error('[QUEUE] ❌ Erro fatal:', error.message);
  }
}

async function sendResult(jobId, status, publications = [], error = null) {
  const webhookUrl = `${SUPABASE_PROJECT_URL}/functions/v1/dje-webhook-receiver`;
  console.log(`[WEBHOOK] Enviando resultado para: ${webhookUrl}`);
  
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'x-webhook-secret': WEBHOOK_SECRET,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jobId,
      status,
      publications,
      error,
      resultsCount: publications.length
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao enviar resultado: ${response.status} - ${errorText}`);
  }
  
  console.log(`[WEBHOOK] ✅ Resultado enviado com sucesso`);
}

module.exports = { processQueue };
