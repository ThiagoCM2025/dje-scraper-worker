import { CronJob } from 'cron';
import { processQueue } from './queue/processor.js';

const CRON_SCHEDULE = '*/5 * * * *'; // A cada 5 minutos

console.log('[WORKER] 🚀 DJE Scraper Worker v3.0 iniciando...');

const job = new CronJob(
  CRON_SCHEDULE,
  async () => {
    console.log('[WORKER] ⏰ Cron job triggered');
    await processQueue();
  },
  null,
  true,
  'America/Sao_Paulo'
);

console.log('[WORKER] ✅ Cron job configurado:', CRON_SCHEDULE);
console.log('[WORKER] 🔄 Worker em execução. Aguardando próximo ciclo...');

// Executar imediatamente na inicialização
processQueue().catch((error: Error) => {
  console.error('[WORKER] ❌ Erro na execução inicial:', error);
});

// Manter processo vivo
process.on('SIGINT', () => {
  console.log('[WORKER] 🛑 Parando worker...');
  job.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[WORKER] 🛑 Parando worker...');
  job.stop();
  process.exit(0);
});
