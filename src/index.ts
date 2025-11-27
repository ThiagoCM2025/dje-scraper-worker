import { createClient } from '@supabase/supabase-js';
import { CronJob } from 'cron';
import { processQueue } from './queue/processor';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log('🚀 DJE Worker iniciado');
console.log('📡 Conectando ao Supabase...');
console.log('⏰ Configurando cron job (a cada 5 minutos)');

const job = new CronJob('*/5 * * * *', async () => {
  console.log('\n⏰ [CRON] Executando verificação da fila...');
  try {
    await processQueue();
  } catch (error) {
    console.error('❌ [CRON] Erro ao processar fila:', error);
  }
});

job.start();

console.log('✅ Worker em execução. Aguardando jobs...');

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recebido, encerrando worker...');
  job.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recebido, encerrando worker...');
  job.stop();
  process.exit(0);
});
