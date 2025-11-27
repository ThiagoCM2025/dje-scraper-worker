import { scrapeTJSP } from '../scrapers/tjsp-playwright';

const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

interface ScrapingJob {
  id: string;
  oab_number: string;
  oab_state: string;
  tribunal: string;
  target_date: string;
  status: string;
  priority: number;
}

interface Publication {
  text: string;
  date: string;
  type?: string;
  processNumber?: string;
}

interface GetJobsResponse {
  jobs: ScrapingJob[];
  count: number;
  message?: string;
}

export async function processQueue(): Promise<void> {
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

    const data: GetJobsResponse = await response.json();
    const { jobs, count } = data;
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
        const publications = result.publications || [];
        
        // Enviar resultado para webhook
        await sendResult(job.id, 'completed', publications);
        console.log(`[QUEUE] ✅ Job ${job.id} completado: ${publications.length} publicações`);
        
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[QUEUE] ❌ Erro no job ${job.id}:`, errorMessage);
        await sendResult(job.id, 'failed', [], errorMessage);
      }
    }

    console.log('[QUEUE] ✅ Ciclo de processamento concluído');

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QUEUE] ❌ Erro fatal:', errorMessage);
  }
}

async function sendResult(
  jobId: string, 
  status: string, 
  publications: Publication[] = [], 
  error: string | null = null
): Promise<void> {
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
